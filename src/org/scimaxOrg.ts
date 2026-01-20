/**
 * Scimax-org: Text markup, DWIM return, and navigation features
 * Inspired by scimax-org.el from Emacs scimax
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
    getTodoWorkflowForDocument,
    getNextTodoState,
    getAllTodoStatesForDocument
} from './todoStates';
import {
    getDayOfWeek,
    findRepeaterInLines,
    advanceDateByRepeater,
    formatOrgTimestamp
} from '../parser/orgRepeater';
import {
    updateDynamicBlockAtCursor,
    isInDynamicBlock
} from '../parser/orgDynamicBlocks';
import { OrgParser } from '../parser/orgParser';

// =============================================================================
// Heading Detection Helpers (org and markdown support)
// =============================================================================

/**
 * Get the heading pattern for the document type
 */
function getHeadingPattern(document: vscode.TextDocument): RegExp {
    if (document.languageId === 'markdown') {
        return /^(#{1,6})\s/;
    }
    return /^(\*+)\s/;
}

/**
 * Get the heading character for the document type
 */
function getHeadingChar(document: vscode.TextDocument): string {
    return document.languageId === 'markdown' ? '#' : '*';
}

/**
 * Check if a line is a heading and return its level
 */
function getHeadingLevel(document: vscode.TextDocument, lineText: string): number {
    const pattern = getHeadingPattern(document);
    const match = lineText.match(pattern);
    return match ? match[1].length : 0;
}

/**
 * Check if a line is a heading
 */
function isHeadingLine(document: vscode.TextDocument, lineText: string): boolean {
    return getHeadingLevel(document, lineText) > 0;
}

// =============================================================================
// Text Markup Functions
// =============================================================================

/**
 * Apply markup to selection or word at point
 * If there's a selection, wrap it. Otherwise, wrap the word at cursor.
 */
async function applyMarkup(
    prefix: string,
    suffix: string,
    editor?: vscode.TextEditor
): Promise<void> {
    editor = editor || vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selection = editor.selection;

    await editor.edit(editBuilder => {
        if (selection.isEmpty) {
            // No selection - wrap word at cursor
            const position = selection.active;
            const wordRange = document.getWordRangeAtPosition(position);

            if (wordRange) {
                const word = document.getText(wordRange);
                editBuilder.replace(wordRange, `${prefix}${word}${suffix}`);
            } else {
                // No word at cursor, insert empty markup
                editBuilder.insert(position, `${prefix}${suffix}`);
            }
        } else {
            // Has selection - wrap selection
            const text = document.getText(selection);
            editBuilder.replace(selection, `${prefix}${text}${suffix}`);
        }
    });
}

/**
 * Make text bold (*bold*)
 */
export async function boldRegionOrPoint(): Promise<void> {
    await applyMarkup('*', '*');
}

/**
 * Make text italic (/italic/)
 */
export async function italicRegionOrPoint(): Promise<void> {
    await applyMarkup('/', '/');
}

/**
 * Make text underlined (_underlined_)
 */
export async function underlineRegionOrPoint(): Promise<void> {
    await applyMarkup('_', '_');
}

/**
 * Make text code (~code~)
 */
export async function codeRegionOrPoint(): Promise<void> {
    await applyMarkup('~', '~');
}

/**
 * Make text verbatim (=verbatim=)
 */
export async function verbatimRegionOrPoint(): Promise<void> {
    await applyMarkup('=', '=');
}

/**
 * Make text strikethrough (+strikethrough+)
 */
export async function strikethroughRegionOrPoint(): Promise<void> {
    await applyMarkup('+', '+');
}

// =============================================================================
// Word Case Functions (Emacs-style M-c, M-l, M-u)
// =============================================================================

/**
 * Move cursor to the start of the next word
 */
async function moveToNextWord(editor: vscode.TextEditor): Promise<void> {
    const position = editor.selection.active;
    const document = editor.document;
    const line = document.lineAt(position.line);

    // First, skip any remaining characters of current word
    let col = position.character;
    while (col < line.text.length && /\w/.test(line.text[col])) {
        col++;
    }

    // Then skip any whitespace/non-word characters
    while (col < line.text.length && !/\w/.test(line.text[col])) {
        col++;
    }

    // If we reached end of line, try next line
    if (col >= line.text.length && position.line < document.lineCount - 1) {
        const nextLine = document.lineAt(position.line + 1);
        let nextCol = 0;
        while (nextCol < nextLine.text.length && !/\w/.test(nextLine.text[nextCol])) {
            nextCol++;
        }
        const newPosition = new vscode.Position(position.line + 1, nextCol);
        editor.selection = new vscode.Selection(newPosition, newPosition);
    } else {
        const newPosition = new vscode.Position(position.line, col);
        editor.selection = new vscode.Selection(newPosition, newPosition);
    }
}

/**
 * Capitalize word at point and move to next word (Emacs M-c)
 * Capitalizes the first letter and lowercases the rest
 */
export async function capitalizeWordAndMove(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const wordRange = document.getWordRangeAtPosition(position);

    if (wordRange) {
        const word = document.getText(wordRange);
        const capitalized = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        await editor.edit(editBuilder => {
            editBuilder.replace(wordRange, capitalized);
        });
    }

    await moveToNextWord(editor);
}

/**
 * Lowercase word at point and move to next word (Emacs M-l)
 */
export async function lowercaseWordAndMove(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const wordRange = document.getWordRangeAtPosition(position);

    if (wordRange) {
        const word = document.getText(wordRange);
        await editor.edit(editBuilder => {
            editBuilder.replace(wordRange, word.toLowerCase());
        });
    }

    await moveToNextWord(editor);
}

/**
 * Uppercase word at point and move to next word (Emacs M-u)
 */
export async function uppercaseWordAndMove(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const wordRange = document.getWordRangeAtPosition(position);

    if (wordRange) {
        const word = document.getText(wordRange);
        await editor.edit(editBuilder => {
            editBuilder.replace(wordRange, word.toUpperCase());
        });
    }

    await moveToNextWord(editor);
}

// =============================================================================
// Non-ASCII Character Replacement
// =============================================================================

/**
 * Comprehensive mapping of non-ASCII characters to ASCII, LaTeX, and HTML equivalents
 */
const NON_ASCII_MAP: Record<string, { ascii: string; latex: string; html: string }> = {
    // Latin letters with diacritics - Acute
    'á': { ascii: 'a', latex: "\\'a", html: '&aacute;' },
    'Á': { ascii: 'A', latex: "\\'A", html: '&Aacute;' },
    'é': { ascii: 'e', latex: "\\'e", html: '&eacute;' },
    'É': { ascii: 'E', latex: "\\'E", html: '&Eacute;' },
    'í': { ascii: 'i', latex: "\\'\\i", html: '&iacute;' },
    'Í': { ascii: 'I', latex: "\\'I", html: '&Iacute;' },
    'ó': { ascii: 'o', latex: "\\'o", html: '&oacute;' },
    'Ó': { ascii: 'O', latex: "\\'O", html: '&Oacute;' },
    'ú': { ascii: 'u', latex: "\\'u", html: '&uacute;' },
    'Ú': { ascii: 'U', latex: "\\'U", html: '&Uacute;' },
    'ý': { ascii: 'y', latex: "\\'y", html: '&yacute;' },
    'Ý': { ascii: 'Y', latex: "\\'Y", html: '&Yacute;' },
    'ć': { ascii: 'c', latex: "\\'c", html: '&#263;' },
    'Ć': { ascii: 'C', latex: "\\'C", html: '&#262;' },
    'ń': { ascii: 'n', latex: "\\'n", html: '&#324;' },
    'Ń': { ascii: 'N', latex: "\\'N", html: '&#323;' },
    'ś': { ascii: 's', latex: "\\'s", html: '&#347;' },
    'Ś': { ascii: 'S', latex: "\\'S", html: '&#346;' },
    'ź': { ascii: 'z', latex: "\\'z", html: '&#378;' },
    'Ź': { ascii: 'Z', latex: "\\'Z", html: '&#377;' },

    // Grave
    'à': { ascii: 'a', latex: '\\`a', html: '&agrave;' },
    'À': { ascii: 'A', latex: '\\`A', html: '&Agrave;' },
    'è': { ascii: 'e', latex: '\\`e', html: '&egrave;' },
    'È': { ascii: 'E', latex: '\\`E', html: '&Egrave;' },
    'ì': { ascii: 'i', latex: '\\`\\i', html: '&igrave;' },
    'Ì': { ascii: 'I', latex: '\\`I', html: '&Igrave;' },
    'ò': { ascii: 'o', latex: '\\`o', html: '&ograve;' },
    'Ò': { ascii: 'O', latex: '\\`O', html: '&Ograve;' },
    'ù': { ascii: 'u', latex: '\\`u', html: '&ugrave;' },
    'Ù': { ascii: 'U', latex: '\\`U', html: '&Ugrave;' },

    // Circumflex
    'â': { ascii: 'a', latex: '\\^a', html: '&acirc;' },
    'Â': { ascii: 'A', latex: '\\^A', html: '&Acirc;' },
    'ê': { ascii: 'e', latex: '\\^e', html: '&ecirc;' },
    'Ê': { ascii: 'E', latex: '\\^E', html: '&Ecirc;' },
    'î': { ascii: 'i', latex: '\\^\\i', html: '&icirc;' },
    'Î': { ascii: 'I', latex: '\\^I', html: '&Icirc;' },
    'ô': { ascii: 'o', latex: '\\^o', html: '&ocirc;' },
    'Ô': { ascii: 'O', latex: '\\^O', html: '&Ocirc;' },
    'û': { ascii: 'u', latex: '\\^u', html: '&ucirc;' },
    'Û': { ascii: 'U', latex: '\\^U', html: '&Ucirc;' },
    'ŵ': { ascii: 'w', latex: '\\^w', html: '&#373;' },
    'Ŵ': { ascii: 'W', latex: '\\^W', html: '&#372;' },
    'ŷ': { ascii: 'y', latex: '\\^y', html: '&#375;' },
    'Ŷ': { ascii: 'Y', latex: '\\^Y', html: '&#374;' },

    // Umlaut/Diaeresis
    'ä': { ascii: 'a', latex: '\\"a', html: '&auml;' },
    'Ä': { ascii: 'A', latex: '\\"A', html: '&Auml;' },
    'ë': { ascii: 'e', latex: '\\"e', html: '&euml;' },
    'Ë': { ascii: 'E', latex: '\\"E', html: '&Euml;' },
    'ï': { ascii: 'i', latex: '\\"\\i', html: '&iuml;' },
    'Ï': { ascii: 'I', latex: '\\"I', html: '&Iuml;' },
    'ö': { ascii: 'o', latex: '\\"o', html: '&ouml;' },
    'Ö': { ascii: 'O', latex: '\\"O', html: '&Ouml;' },
    'ü': { ascii: 'u', latex: '\\"u', html: '&uuml;' },
    'Ü': { ascii: 'U', latex: '\\"U', html: '&Uuml;' },
    'ÿ': { ascii: 'y', latex: '\\"y', html: '&yuml;' },
    'Ÿ': { ascii: 'Y', latex: '\\"Y', html: '&Yuml;' },

    // Tilde
    'ã': { ascii: 'a', latex: '\\~a', html: '&atilde;' },
    'Ã': { ascii: 'A', latex: '\\~A', html: '&Atilde;' },
    'ñ': { ascii: 'n', latex: '\\~n', html: '&ntilde;' },
    'Ñ': { ascii: 'N', latex: '\\~N', html: '&Ntilde;' },
    'õ': { ascii: 'o', latex: '\\~o', html: '&otilde;' },
    'Õ': { ascii: 'O', latex: '\\~O', html: '&Otilde;' },

    // Cedilla
    'ç': { ascii: 'c', latex: '\\c{c}', html: '&ccedil;' },
    'Ç': { ascii: 'C', latex: '\\c{C}', html: '&Ccedil;' },
    'ş': { ascii: 's', latex: '\\c{s}', html: '&#351;' },
    'Ş': { ascii: 'S', latex: '\\c{S}', html: '&#350;' },
    'ţ': { ascii: 't', latex: '\\c{t}', html: '&#355;' },
    'Ţ': { ascii: 'T', latex: '\\c{T}', html: '&#354;' },

    // Ring
    'å': { ascii: 'a', latex: '\\aa{}', html: '&aring;' },
    'Å': { ascii: 'A', latex: '\\AA{}', html: '&Aring;' },
    'ů': { ascii: 'u', latex: '\\r{u}', html: '&#367;' },
    'Ů': { ascii: 'U', latex: '\\r{U}', html: '&#366;' },

    // Stroke/Slash
    'ø': { ascii: 'o', latex: '\\o{}', html: '&oslash;' },
    'Ø': { ascii: 'O', latex: '\\O{}', html: '&Oslash;' },
    'ł': { ascii: 'l', latex: '\\l{}', html: '&#322;' },
    'Ł': { ascii: 'L', latex: '\\L{}', html: '&#321;' },
    'đ': { ascii: 'd', latex: '\\dj{}', html: '&#273;' },
    'Đ': { ascii: 'D', latex: '\\DJ{}', html: '&#272;' },

    // Caron/Háček
    'č': { ascii: 'c', latex: '\\v{c}', html: '&#269;' },
    'Č': { ascii: 'C', latex: '\\v{C}', html: '&#268;' },
    'š': { ascii: 's', latex: '\\v{s}', html: '&#353;' },
    'Š': { ascii: 'S', latex: '\\v{S}', html: '&#352;' },
    'ž': { ascii: 'z', latex: '\\v{z}', html: '&#382;' },
    'Ž': { ascii: 'Z', latex: '\\v{Z}', html: '&#381;' },
    'ř': { ascii: 'r', latex: '\\v{r}', html: '&#345;' },
    'Ř': { ascii: 'R', latex: '\\v{R}', html: '&#344;' },
    'ě': { ascii: 'e', latex: '\\v{e}', html: '&#283;' },
    'Ě': { ascii: 'E', latex: '\\v{E}', html: '&#282;' },
    'ň': { ascii: 'n', latex: '\\v{n}', html: '&#328;' },
    'Ň': { ascii: 'N', latex: '\\v{N}', html: '&#327;' },
    'ť': { ascii: 't', latex: '\\v{t}', html: '&#357;' },
    'Ť': { ascii: 'T', latex: '\\v{T}', html: '&#356;' },
    'ď': { ascii: 'd', latex: '\\v{d}', html: '&#271;' },
    'Ď': { ascii: 'D', latex: '\\v{D}', html: '&#270;' },

    // Macron
    'ā': { ascii: 'a', latex: '\\={a}', html: '&#257;' },
    'Ā': { ascii: 'A', latex: '\\={A}', html: '&#256;' },
    'ē': { ascii: 'e', latex: '\\={e}', html: '&#275;' },
    'Ē': { ascii: 'E', latex: '\\={E}', html: '&#274;' },
    'ī': { ascii: 'i', latex: '\\={\\i}', html: '&#299;' },
    'Ī': { ascii: 'I', latex: '\\={I}', html: '&#298;' },
    'ō': { ascii: 'o', latex: '\\={o}', html: '&#333;' },
    'Ō': { ascii: 'O', latex: '\\={O}', html: '&#332;' },
    'ū': { ascii: 'u', latex: '\\={u}', html: '&#363;' },
    'Ū': { ascii: 'U', latex: '\\={U}', html: '&#362;' },

    // Breve
    'ă': { ascii: 'a', latex: '\\u{a}', html: '&#259;' },
    'Ă': { ascii: 'A', latex: '\\u{A}', html: '&#258;' },
    'ğ': { ascii: 'g', latex: '\\u{g}', html: '&#287;' },
    'Ğ': { ascii: 'G', latex: '\\u{G}', html: '&#286;' },
    'ŭ': { ascii: 'u', latex: '\\u{u}', html: '&#365;' },
    'Ŭ': { ascii: 'U', latex: '\\u{U}', html: '&#364;' },

    // Ogonek
    'ą': { ascii: 'a', latex: '\\k{a}', html: '&#261;' },
    'Ą': { ascii: 'A', latex: '\\k{A}', html: '&#260;' },
    'ę': { ascii: 'e', latex: '\\k{e}', html: '&#281;' },
    'Ę': { ascii: 'E', latex: '\\k{E}', html: '&#280;' },

    // Dot above
    'ė': { ascii: 'e', latex: '\\.{e}', html: '&#279;' },
    'Ė': { ascii: 'E', latex: '\\.{E}', html: '&#278;' },
    'ż': { ascii: 'z', latex: '\\.{z}', html: '&#380;' },
    'Ż': { ascii: 'Z', latex: '\\.{Z}', html: '&#379;' },
    'İ': { ascii: 'I', latex: '\\.{I}', html: '&#304;' },

    // Dotless
    'ı': { ascii: 'i', latex: '\\i{}', html: '&#305;' },

    // Special letters
    'æ': { ascii: 'ae', latex: '\\ae{}', html: '&aelig;' },
    'Æ': { ascii: 'AE', latex: '\\AE{}', html: '&AElig;' },
    'œ': { ascii: 'oe', latex: '\\oe{}', html: '&oelig;' },
    'Œ': { ascii: 'OE', latex: '\\OE{}', html: '&OElig;' },
    'ß': { ascii: 'ss', latex: '\\ss{}', html: '&szlig;' },
    'ð': { ascii: 'd', latex: '\\dh{}', html: '&eth;' },
    'Ð': { ascii: 'D', latex: '\\DH{}', html: '&ETH;' },
    'þ': { ascii: 'th', latex: '\\th{}', html: '&thorn;' },
    'Þ': { ascii: 'Th', latex: '\\TH{}', html: '&THORN;' },

    // Greek letters (common in scientific text)
    'α': { ascii: 'alpha', latex: '$\\alpha$', html: '&alpha;' },
    'β': { ascii: 'beta', latex: '$\\beta$', html: '&beta;' },
    'γ': { ascii: 'gamma', latex: '$\\gamma$', html: '&gamma;' },
    'δ': { ascii: 'delta', latex: '$\\delta$', html: '&delta;' },
    'ε': { ascii: 'epsilon', latex: '$\\epsilon$', html: '&epsilon;' },
    'ζ': { ascii: 'zeta', latex: '$\\zeta$', html: '&zeta;' },
    'η': { ascii: 'eta', latex: '$\\eta$', html: '&eta;' },
    'θ': { ascii: 'theta', latex: '$\\theta$', html: '&theta;' },
    'ι': { ascii: 'iota', latex: '$\\iota$', html: '&iota;' },
    'κ': { ascii: 'kappa', latex: '$\\kappa$', html: '&kappa;' },
    'λ': { ascii: 'lambda', latex: '$\\lambda$', html: '&lambda;' },
    'μ': { ascii: 'mu', latex: '$\\mu$', html: '&mu;' },
    'ν': { ascii: 'nu', latex: '$\\nu$', html: '&nu;' },
    'ξ': { ascii: 'xi', latex: '$\\xi$', html: '&xi;' },
    'π': { ascii: 'pi', latex: '$\\pi$', html: '&pi;' },
    'ρ': { ascii: 'rho', latex: '$\\rho$', html: '&rho;' },
    'σ': { ascii: 'sigma', latex: '$\\sigma$', html: '&sigma;' },
    'τ': { ascii: 'tau', latex: '$\\tau$', html: '&tau;' },
    'υ': { ascii: 'upsilon', latex: '$\\upsilon$', html: '&upsilon;' },
    'φ': { ascii: 'phi', latex: '$\\phi$', html: '&phi;' },
    'χ': { ascii: 'chi', latex: '$\\chi$', html: '&chi;' },
    'ψ': { ascii: 'psi', latex: '$\\psi$', html: '&psi;' },
    'ω': { ascii: 'omega', latex: '$\\omega$', html: '&omega;' },
    'Γ': { ascii: 'Gamma', latex: '$\\Gamma$', html: '&Gamma;' },
    'Δ': { ascii: 'Delta', latex: '$\\Delta$', html: '&Delta;' },
    'Θ': { ascii: 'Theta', latex: '$\\Theta$', html: '&Theta;' },
    'Λ': { ascii: 'Lambda', latex: '$\\Lambda$', html: '&Lambda;' },
    'Ξ': { ascii: 'Xi', latex: '$\\Xi$', html: '&Xi;' },
    'Π': { ascii: 'Pi', latex: '$\\Pi$', html: '&Pi;' },
    'Σ': { ascii: 'Sigma', latex: '$\\Sigma$', html: '&Sigma;' },
    'Φ': { ascii: 'Phi', latex: '$\\Phi$', html: '&Phi;' },
    'Ψ': { ascii: 'Psi', latex: '$\\Psi$', html: '&Psi;' },
    'Ω': { ascii: 'Omega', latex: '$\\Omega$', html: '&Omega;' },

    // Punctuation and symbols
    '–': { ascii: '-', latex: '--', html: '&ndash;' },
    '—': { ascii: '--', latex: '---', html: '&mdash;' },
    '\u2018': { ascii: "'", latex: '`', html: '&lsquo;' },  // '
    '\u2019': { ascii: "'", latex: "'", html: '&rsquo;' },  // '
    '\u201C': { ascii: '"', latex: '``', html: '&ldquo;' }, // "
    '\u201D': { ascii: '"', latex: "''", html: '&rdquo;' }, // "
    '\u201E': { ascii: '"', latex: ',,', html: '&bdquo;' }, // „
    '«': { ascii: '<<', latex: '\\guillemotleft{}', html: '&laquo;' },
    '»': { ascii: '>>', latex: '\\guillemotright{}', html: '&raquo;' },
    '‹': { ascii: '<', latex: '\\guilsinglleft{}', html: '&lsaquo;' },
    '›': { ascii: '>', latex: '\\guilsinglright{}', html: '&rsaquo;' },
    '…': { ascii: '...', latex: '\\ldots{}', html: '&hellip;' },
    '·': { ascii: '.', latex: '\\cdot{}', html: '&middot;' },
    '•': { ascii: '*', latex: '\\textbullet{}', html: '&bull;' },
    '†': { ascii: '+', latex: '\\dag{}', html: '&dagger;' },
    '‡': { ascii: '++', latex: '\\ddag{}', html: '&Dagger;' },
    '§': { ascii: 'S', latex: '\\S{}', html: '&sect;' },
    '¶': { ascii: 'P', latex: '\\P{}', html: '&para;' },
    '©': { ascii: '(c)', latex: '\\copyright{}', html: '&copy;' },
    '®': { ascii: '(R)', latex: '\\textregistered{}', html: '&reg;' },
    '™': { ascii: '(TM)', latex: '\\texttrademark{}', html: '&trade;' },
    '°': { ascii: 'deg', latex: '\\textdegree{}', html: '&deg;' },
    '′': { ascii: "'", latex: "'", html: '&prime;' },
    '″': { ascii: "''", latex: "''", html: '&Prime;' },
    '±': { ascii: '+/-', latex: '$\\pm$', html: '&plusmn;' },
    '×': { ascii: 'x', latex: '$\\times$', html: '&times;' },
    '÷': { ascii: '/', latex: '$\\div$', html: '&divide;' },
    '≤': { ascii: '<=', latex: '$\\leq$', html: '&le;' },
    '≥': { ascii: '>=', latex: '$\\geq$', html: '&ge;' },
    '≠': { ascii: '!=', latex: '$\\neq$', html: '&ne;' },
    '≈': { ascii: '~=', latex: '$\\approx$', html: '&asymp;' },
    '∞': { ascii: 'inf', latex: '$\\infty$', html: '&infin;' },
    '√': { ascii: 'sqrt', latex: '$\\sqrt{}$', html: '&radic;' },
    '∑': { ascii: 'sum', latex: '$\\sum$', html: '&sum;' },
    '∏': { ascii: 'prod', latex: '$\\prod$', html: '&prod;' },
    '∫': { ascii: 'int', latex: '$\\int$', html: '&int;' },
    '∂': { ascii: 'd', latex: '$\\partial$', html: '&part;' },
    '∇': { ascii: 'nabla', latex: '$\\nabla$', html: '&nabla;' },
    '∈': { ascii: 'in', latex: '$\\in$', html: '&isin;' },
    '∉': { ascii: 'notin', latex: '$\\notin$', html: '&notin;' },
    '⊂': { ascii: 'subset', latex: '$\\subset$', html: '&sub;' },
    '⊃': { ascii: 'supset', latex: '$\\supset$', html: '&sup;' },
    '∪': { ascii: 'union', latex: '$\\cup$', html: '&cup;' },
    '∩': { ascii: 'intersect', latex: '$\\cap$', html: '&cap;' },
    '∧': { ascii: 'and', latex: '$\\land$', html: '&and;' },
    '∨': { ascii: 'or', latex: '$\\lor$', html: '&or;' },
    '¬': { ascii: 'not', latex: '$\\neg$', html: '&not;' },
    '∀': { ascii: 'forall', latex: '$\\forall$', html: '&forall;' },
    '∃': { ascii: 'exists', latex: '$\\exists$', html: '&exist;' },
    '∅': { ascii: 'empty', latex: '$\\emptyset$', html: '&empty;' },
    '→': { ascii: '->', latex: '$\\rightarrow$', html: '&rarr;' },
    '←': { ascii: '<-', latex: '$\\leftarrow$', html: '&larr;' },
    '↔': { ascii: '<->', latex: '$\\leftrightarrow$', html: '&harr;' },
    '⇒': { ascii: '=>', latex: '$\\Rightarrow$', html: '&rArr;' },
    '⇐': { ascii: '<=', latex: '$\\Leftarrow$', html: '&lArr;' },
    '⇔': { ascii: '<=>', latex: '$\\Leftrightarrow$', html: '&hArr;' },

    // Currency
    '€': { ascii: 'EUR', latex: '\\euro{}', html: '&euro;' },
    '£': { ascii: 'GBP', latex: '\\pounds{}', html: '&pound;' },
    '¥': { ascii: 'JPY', latex: '\\textyen{}', html: '&yen;' },
    '¢': { ascii: 'c', latex: '\\cent{}', html: '&cent;' },

    // Fractions
    '½': { ascii: '1/2', latex: '$\\frac{1}{2}$', html: '&frac12;' },
    '¼': { ascii: '1/4', latex: '$\\frac{1}{4}$', html: '&frac14;' },
    '¾': { ascii: '3/4', latex: '$\\frac{3}{4}$', html: '&frac34;' },
    '⅓': { ascii: '1/3', latex: '$\\frac{1}{3}$', html: '&#8531;' },
    '⅔': { ascii: '2/3', latex: '$\\frac{2}{3}$', html: '&#8532;' },

    // Superscripts and subscripts
    '¹': { ascii: '1', latex: '$^1$', html: '&sup1;' },
    '²': { ascii: '2', latex: '$^2$', html: '&sup2;' },
    '³': { ascii: '3', latex: '$^3$', html: '&sup3;' },
    '⁰': { ascii: '0', latex: '$^0$', html: '&#8304;' },
    '⁴': { ascii: '4', latex: '$^4$', html: '&#8308;' },
    '⁵': { ascii: '5', latex: '$^5$', html: '&#8309;' },
    '⁶': { ascii: '6', latex: '$^6$', html: '&#8310;' },
    '⁷': { ascii: '7', latex: '$^7$', html: '&#8311;' },
    '⁸': { ascii: '8', latex: '$^8$', html: '&#8312;' },
    '⁹': { ascii: '9', latex: '$^9$', html: '&#8313;' },
    '⁺': { ascii: '+', latex: '$^+$', html: '&#8314;' },
    '⁻': { ascii: '-', latex: '$^-$', html: '&#8315;' },
    '₀': { ascii: '0', latex: '$_0$', html: '&#8320;' },
    '₁': { ascii: '1', latex: '$_1$', html: '&#8321;' },
    '₂': { ascii: '2', latex: '$_2$', html: '&#8322;' },
    '₃': { ascii: '3', latex: '$_3$', html: '&#8323;' },
    '₄': { ascii: '4', latex: '$_4$', html: '&#8324;' },
    '₅': { ascii: '5', latex: '$_5$', html: '&#8325;' },
    '₆': { ascii: '6', latex: '$_6$', html: '&#8326;' },
    '₇': { ascii: '7', latex: '$_7$', html: '&#8327;' },
    '₈': { ascii: '8', latex: '$_8$', html: '&#8328;' },
    '₉': { ascii: '9', latex: '$_9$', html: '&#8329;' },

    // Misc
    'ﬁ': { ascii: 'fi', latex: 'fi', html: 'fi' },
    'ﬂ': { ascii: 'fl', latex: 'fl', html: 'fl' },
    'ﬀ': { ascii: 'ff', latex: 'ff', html: 'ff' },
    'ﬃ': { ascii: 'ffi', latex: 'ffi', html: 'ffi' },
    'ﬄ': { ascii: 'ffl', latex: 'ffl', html: 'ffl' },
    '\u00A0': { ascii: ' ', latex: '~', html: '&nbsp;' }, // Non-breaking space
    '\u2009': { ascii: ' ', latex: '\\,', html: '&thinsp;' }, // Thin space
    '\u2003': { ascii: '  ', latex: '\\quad{}', html: '&emsp;' }, // Em space
    '\u2002': { ascii: ' ', latex: '\\enspace{}', html: '&ensp;' }, // En space
};

// Session storage for user-defined replacements
const userDefinedReplacements: Record<string, { ascii: string; latex: string; html: string }> = {};

/**
 * Find all non-ASCII characters in text
 */
function findNonAsciiChars(text: string): { char: string; positions: number[] }[] {
    const nonAscii: Map<string, number[]> = new Map();

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char.charCodeAt(0) > 127) {
            const positions = nonAscii.get(char) || [];
            positions.push(i);
            nonAscii.set(char, positions);
        }
    }

    return Array.from(nonAscii.entries()).map(([char, positions]) => ({ char, positions }));
}

/**
 * Get replacement for a character based on context
 */
function getReplacementForContext(
    char: string,
    context: 'ascii' | 'latex' | 'html'
): string | undefined {
    // Check user-defined first
    if (userDefinedReplacements[char]) {
        return userDefinedReplacements[char][context];
    }
    // Then check built-in map
    if (NON_ASCII_MAP[char]) {
        return NON_ASCII_MAP[char][context];
    }
    return undefined;
}

/**
 * Replace non-ASCII characters in the current document
 * Detects context (LaTeX, HTML, or plain text) and uses appropriate replacements
 */
export async function replaceNonAsciiChars(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const text = document.getText();

    // Detect context based on language ID
    let context: 'ascii' | 'latex' | 'html' = 'ascii';
    if (document.languageId === 'latex' || document.languageId === 'tex') {
        context = 'latex';
    } else if (document.languageId === 'html' || document.languageId === 'xml') {
        context = 'html';
    }

    // Find all non-ASCII characters
    const nonAsciiChars = findNonAsciiChars(text);

    if (nonAsciiChars.length === 0) {
        vscode.window.showInformationMessage('No non-ASCII characters found');
        return;
    }

    // Categorize characters
    const knownChars: { char: string; replacement: string; positions: number[] }[] = [];
    const unknownChars: { char: string; positions: number[] }[] = [];

    for (const { char, positions } of nonAsciiChars) {
        const replacement = getReplacementForContext(char, context);
        if (replacement !== undefined) {
            knownChars.push({ char, replacement, positions });
        } else {
            unknownChars.push({ char, positions });
        }
    }

    // Handle unknown characters first - ask user what to do
    for (const { char, positions } of unknownChars) {
        const charCode = char.charCodeAt(0);
        const charDisplay = `'${char}' (U+${charCode.toString(16).toUpperCase().padStart(4, '0')})`;

        const action = await vscode.window.showQuickPick([
            { label: 'Enter replacement', description: 'Provide a custom replacement' },
            { label: 'Ignore', description: 'Skip this character' },
            { label: 'Delete', description: 'Remove this character' },
            { label: 'Cancel', description: 'Stop replacement process' }
        ], {
            placeHolder: `Unknown character ${charDisplay} found ${positions.length} time(s). What to do?`
        });

        if (!action || action.label === 'Cancel') {
            return;
        }

        if (action.label === 'Enter replacement') {
            const replacement = await vscode.window.showInputBox({
                prompt: `Enter replacement for ${charDisplay}`,
                placeHolder: 'Replacement text'
            });

            if (replacement !== undefined) {
                // Store for this session
                userDefinedReplacements[char] = {
                    ascii: replacement,
                    latex: replacement,
                    html: replacement
                };
                knownChars.push({ char, replacement, positions });
            }
        } else if (action.label === 'Delete') {
            knownChars.push({ char, replacement: '', positions });
        }
        // 'Ignore' does nothing - character stays
    }

    // Perform replacements
    if (knownChars.length === 0) {
        vscode.window.showInformationMessage('No replacements to make');
        return;
    }

    // Build replacement map
    const replacementMap = new Map<string, string>();
    for (const { char, replacement } of knownChars) {
        replacementMap.set(char, replacement);
    }

    // Apply replacements
    let newText = text;
    let totalReplacements = 0;

    for (const [char, replacement] of replacementMap) {
        const regex = new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = newText.match(regex);
        if (matches) {
            totalReplacements += matches.length;
            newText = newText.replace(regex, replacement);
        }
    }

    if (newText !== text) {
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(text.length)
        );

        await editor.edit(editBuilder => {
            editBuilder.replace(fullRange, newText);
        });

        const contextName = context === 'latex' ? 'LaTeX' : context === 'html' ? 'HTML' : 'ASCII';
        vscode.window.showInformationMessage(
            `Replaced ${totalReplacements} non-ASCII character(s) with ${contextName} equivalents`
        );
    }
}

/**
 * Make text an Emacs-style command (`command')
 */
export async function commandRegionOrPoint(): Promise<void> {
    await applyMarkup('`', "'");
}

/**
 * Make text subscript (_{subscript})
 */
export async function subscriptRegionOrPoint(): Promise<void> {
    await applyMarkup('_{', '}');
}

/**
 * Make text superscript (^{superscript})
 */
export async function superscriptRegionOrPoint(): Promise<void> {
    await applyMarkup('^{', '}');
}

/**
 * Wrap in LaTeX math ($math$)
 */
export async function latexMathRegionOrPoint(): Promise<void> {
    await applyMarkup('$', '$');
}

/**
 * Wrap in LaTeX display math (\[math\])
 */
export async function latexDisplayMathRegionOrPoint(): Promise<void> {
    await applyMarkup('\\[', '\\]');
}

// =============================================================================
// DWIM Return (Do What I Mean)
// =============================================================================

/**
 * Smart return that creates appropriate content based on context:
 * - On a link: open the link
 * - On a heading: create new heading after subtree, or delete if empty
 * - On a list item: create new item, or delete if empty
 * - On a checkbox: create new checkbox item, or delete if empty
 * - In a table: move to next row, or delete if empty
 * - In a src block: normal newline
 * - Otherwise: normal newline
 */
export async function dwimReturn(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Check if in a src block - use normal newline
    if (isInSrcBlock(document, position)) {
        return false;
    }

    // Check if on a link - open it (unless at end of line)
    const linkInfo = getLinkAtPoint(document, position);
    if (linkInfo && position.character < line.text.length) {
        await openLinkAtPoint();
        return true;
    }

    // Check if in a table
    if (isInTable(lineText)) {
        return await handleTableReturn(editor, position);
    }

    // Check if on a checkbox item (must check before regular list)
    const checkboxMatch = lineText.match(/^(\s*)([-+*]|\d+[.)])\s+\[[ Xx-]\]\s*(.*)$/);
    if (checkboxMatch) {
        return await handleCheckboxReturn(editor, position, checkboxMatch);
    }

    // Check if on a list item
    const listMatch = lineText.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
    if (listMatch) {
        return await handleListReturn(editor, position, listMatch);
    }

    // Check if on a heading (but not inline task)
    const headingMatch = lineText.match(/^(\*+)\s+/);
    if (headingMatch) {
        // Check for inline task (starts with many stars and ends with many stars)
        const inlineTaskMatch = lineText.match(/^\*{3,}\s+.*\s+\*{3,}$/);
        if (inlineTaskMatch) {
            // Don't handle inline tasks specially
            return false;
        }
        return await handleHeadingReturn(editor, position, headingMatch);
    }

    // Default: normal newline
    return false;
}

/**
 * Check if cursor is inside a source block
 */
function isInSrcBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
    // Search upward for #+BEGIN_SRC
    for (let i = position.line; i >= 0; i--) {
        const lineText = document.lineAt(i).text.trim().toLowerCase();
        if (lineText.startsWith('#+begin_src')) {
            // Found start, check if we're before the end
            for (let j = position.line; j < document.lineCount; j++) {
                const endLine = document.lineAt(j).text.trim().toLowerCase();
                if (endLine.startsWith('#+end_src')) {
                    return true;
                }
            }
            return false;
        }
        if (lineText.startsWith('#+end_src')) {
            return false;
        }
    }
    return false;
}

/**
 * Check if line is in a table
 */
function isInTable(lineText: string): boolean {
    return lineText.trim().startsWith('|') && lineText.trim().endsWith('|');
}

/**
 * Handle return in a table - move to next row, create new row, or delete empty row
 */
async function handleTableReturn(
    editor: vscode.TextEditor,
    position: vscode.Position
): Promise<boolean> {
    const document = editor.document;
    const currentLine = document.lineAt(position.line);
    const currentLineText = currentLine.text;

    // Check if current row is empty (all cells are whitespace only)
    // Skip separator rows (containing only |, -, +)
    const isSeparator = /^\s*\|[-+|]+\|\s*$/.test(currentLineText);
    if (!isSeparator) {
        const cells = currentLineText.split('|').slice(1, -1);
        const isEmptyRow = cells.every(cell => cell.trim() === '');

        if (isEmptyRow) {
            // Delete the empty row
            await editor.edit(editBuilder => {
                editBuilder.delete(currentLine.rangeIncludingLineBreak);
            });
            return true;
        }
    }

    const nextLine = position.line + 1;
    if (nextLine < document.lineCount) {
        const nextLineText = document.lineAt(nextLine).text;
        if (isInTable(nextLineText)) {
            // Move to first cell of next row
            const firstPipe = nextLineText.indexOf('|');
            const newPos = new vscode.Position(nextLine, firstPipe + 2);
            editor.selection = new vscode.Selection(newPos, newPos);
            return true;
        }
    }

    // Create new row - copy structure from current row
    const cells = currentLineText.split('|').slice(1, -1);
    const newRow = '|' + cells.map(c => ' '.repeat(c.length)).join('|') + '|';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line + 1, 0), newRow + '\n');
    });

    // Move to first cell
    const newPos = new vscode.Position(position.line + 1, 2);
    editor.selection = new vscode.Selection(newPos, newPos);
    return true;
}

/**
 * Handle return on a list item - create new item or delete empty item
 */
async function handleListReturn(
    editor: vscode.TextEditor,
    position: vscode.Position,
    match: RegExpMatchArray
): Promise<boolean> {
    const [fullMatch, indent, bullet, content] = match;
    const document = editor.document;
    const line = document.lineAt(position.line);

    // Check for empty definition list item (- ::)
    if (content.trim() === '::' || content.trim() === '') {
        // Empty item - delete the line
        await editor.edit(editBuilder => {
            editBuilder.delete(line.rangeIncludingLineBreak);
        });
        return true;
    }

    // Check if we're at end of line
    if (position.character < line.text.length) {
        // Not at end of line - do normal return
        return false;
    }

    // Create new item at end of line
    let newBullet = bullet;
    // If numbered list, increment
    const numMatch = bullet.match(/^(\d+)([.)])/);
    if (numMatch) {
        newBullet = `${parseInt(numMatch[1]) + 1}${numMatch[2]}`;
    }

    // Check if this is a definition list item (contains ::)
    const isDefinitionItem = content.includes('::');
    const newContent = isDefinitionItem ? ' :: ' : ' ';

    const newItem = `\n${indent}${newBullet}${newContent}`;

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, line.text.length), newItem);
    });

    // Move cursor to end of new bullet
    const cursorOffset = isDefinitionItem ? indent.length + newBullet.length + 4 : indent.length + newBullet.length + 1;
    const newPos = new vscode.Position(position.line + 1, cursorOffset);
    editor.selection = new vscode.Selection(newPos, newPos);
    return true;
}

/**
 * Handle return on a checkbox item - create new checkbox or delete empty item
 */
async function handleCheckboxReturn(
    editor: vscode.TextEditor,
    position: vscode.Position,
    match: RegExpMatchArray
): Promise<boolean> {
    const [fullMatch, indent, bullet, content] = match;
    const document = editor.document;
    const line = document.lineAt(position.line);

    // If content is empty, delete the line
    if (content.trim() === '') {
        await editor.edit(editBuilder => {
            editBuilder.delete(line.rangeIncludingLineBreak);
        });
        return true;
    }

    // Check if we're at end of line
    if (position.character < line.text.length) {
        // Not at end of line - do normal return
        return false;
    }

    // Create new checkbox item at end of line
    let newBullet = bullet;
    const numMatch = bullet.match(/^(\d+)([.)])/);
    if (numMatch) {
        newBullet = `${parseInt(numMatch[1]) + 1}${numMatch[2]}`;
    }

    const newItem = `\n${indent}${newBullet} [ ] `;

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, line.text.length), newItem);
    });

    const newPos = new vscode.Position(position.line + 1, indent.length + newBullet.length + 5);
    editor.selection = new vscode.Selection(newPos, newPos);
    return true;
}

/**
 * Handle return on a heading - create new heading after subtree or delete if empty
 */
async function handleHeadingReturn(
    editor: vscode.TextEditor,
    position: vscode.Position,
    match: RegExpMatchArray
): Promise<boolean> {
    const document = editor.document;
    const stars = match[1];
    const currentLine = document.lineAt(position.line);
    const lineText = currentLine.text;

    // Extract the heading title (after stars and space, before tags)
    const titleMatch = lineText.match(/^\*+\s+(.*?)(?:\s+:[\w:]+:)?\s*$/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Remove TODO keywords and priorities from title for emptiness check
    const cleanTitle = title
        .replace(/^(TODO|DONE|NEXT|WAIT|CANCELLED|IN-PROGRESS|WAITING)\s+/, '')
        .replace(/^\[#[A-Z]\]\s*/, '')
        .trim();

    // If heading is empty, delete the line
    if (cleanTitle === '') {
        await editor.edit(editBuilder => {
            // Delete the entire line including newline
            const range = currentLine.rangeIncludingLineBreak;
            editBuilder.delete(range);
        });
        return true;
    }

    // Find end of subtree
    const level = stars.length;
    let endLine = position.line;

    for (let i = position.line + 1; i < document.lineCount; i++) {
        const nextLine = document.lineAt(i).text;
        const nextHeadingMatch = nextLine.match(/^(\*+)\s+/);
        if (nextHeadingMatch) {
            // Found another heading - check if it's same level or higher (fewer stars)
            if (nextHeadingMatch[1].length <= level) {
                break;
            }
        }
        endLine = i;
    }

    // Insert new heading after subtree
    const insertLine = endLine;
    const insertPos = new vscode.Position(insertLine, document.lineAt(insertLine).text.length);
    const newHeading = `\n\n${stars} `;

    await editor.edit(editBuilder => {
        editBuilder.insert(insertPos, newHeading);
    });

    // Move cursor to the new heading
    const newPos = new vscode.Position(insertLine + 2, stars.length + 1);
    editor.selection = new vscode.Selection(newPos, newPos);
    editor.revealRange(new vscode.Range(newPos, newPos));
    return true;
}

// =============================================================================
// Navigation Functions
// =============================================================================

/**
 * Jump to a heading in the current buffer using quick pick
 */
export async function jumpToHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const headings: { label: string; line: number; level: number }[] = [];
    const isMarkdown = document.languageId === 'markdown';

    // Pattern for headings: org uses *, markdown uses #
    const headingPattern = isMarkdown ? /^(#{1,6})\s+(.*)$/ : /^(\*+)\s+(.*)$/;

    // Find all headings
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(headingPattern);
        if (match) {
            const level = match[1].length;
            const title = match[2].replace(/\s*:[\w:]+:\s*$/, ''); // Remove tags
            const indent = '  '.repeat(level - 1);
            headings.push({
                label: `${indent}${title}`,
                line: i,
                level
            });
        }
    }

    if (headings.length === 0) {
        vscode.window.showInformationMessage('No headings found in document');
        return;
    }

    const selected = await vscode.window.showQuickPick(
        headings.map(h => ({
            label: h.label,
            description: `Line ${h.line + 1}`,
            line: h.line
        })),
        {
            placeHolder: 'Jump to heading...',
            matchOnDescription: true
        }
    );

    if (selected) {
        const pos = new vscode.Position(selected.line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
}

/**
 * Jump to next heading (supports org and markdown)
 */
export async function nextHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;

    for (let i = currentLine + 1; i < document.lineCount; i++) {
        if (isHeadingLine(document, document.lineAt(i).text)) {
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No more headings');
}

/**
 * Jump to previous heading (supports org and markdown)
 */
export async function previousHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;

    for (let i = currentLine - 1; i >= 0; i--) {
        if (isHeadingLine(document, document.lineAt(i).text)) {
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No previous heading');
}

/**
 * Jump to parent heading (supports org and markdown)
 */
export async function parentHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;

    // Find current heading level
    let currentLevel = 0;
    for (let i = currentLine; i >= 0; i--) {
        const level = getHeadingLevel(document, document.lineAt(i).text);
        if (level > 0) {
            currentLevel = level;
            break;
        }
    }

    if (currentLevel <= 1) {
        vscode.window.showInformationMessage('Already at top level');
        return;
    }

    // Find parent (heading with lower level)
    for (let i = currentLine - 1; i >= 0; i--) {
        const level = getHeadingLevel(document, document.lineAt(i).text);
        if (level > 0 && level < currentLevel) {
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No parent heading found');
}

// =============================================================================
// Heading Manipulation
// =============================================================================

/**
 * Promote heading (decrease level) - supports org and markdown
 */
export async function promoteHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const level = getHeadingLevel(document, line.text);

    if (level <= 1) {
        vscode.window.showInformationMessage('Cannot promote further');
        return;
    }

    await editor.edit(editBuilder => {
        editBuilder.delete(new vscode.Range(position.line, 0, position.line, 1));
    });
}

/**
 * Demote heading (increase level) - supports org and markdown
 */
export async function demoteHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const level = getHeadingLevel(document, line.text);

    if (level === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    // Markdown headings max out at level 6
    if (document.languageId === 'markdown' && level >= 6) {
        vscode.window.showInformationMessage('Cannot demote further (max level 6)');
        return;
    }

    const headingChar = getHeadingChar(document);
    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, 0), headingChar);
    });
}

/**
 * Promote subtree (heading and all children) - supports org and markdown
 */
export async function promoteSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    // Check if can promote
    const firstLine = document.lineAt(startLine).text;
    const level = getHeadingLevel(document, firstLine);
    if (level <= 1) {
        vscode.window.showInformationMessage('Cannot promote further');
        return;
    }

    await editor.edit(editBuilder => {
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i).text;
            if (isHeadingLine(document, line)) {
                editBuilder.delete(new vscode.Range(i, 0, i, 1));
            }
        }
    });
}

/**
 * Demote subtree (heading and all children) - supports org and markdown
 */
export async function demoteSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    // Check if any heading would exceed max level (markdown: 6)
    if (document.languageId === 'markdown') {
        for (let i = startLine; i <= endLine; i++) {
            const level = getHeadingLevel(document, document.lineAt(i).text);
            if (level >= 6) {
                vscode.window.showInformationMessage('Cannot demote: subtree contains heading at max level (6)');
                return;
            }
        }
    }

    const headingChar = getHeadingChar(document);
    await editor.edit(editBuilder => {
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i).text;
            if (isHeadingLine(document, line)) {
                editBuilder.insert(new vscode.Position(i, 0), headingChar);
            }
        }
    });
}

/**
 * Get the range of a subtree (heading + all children) - supports org and markdown
 */
function getSubtreeRange(document: vscode.TextDocument, line: number): { startLine: number; endLine: number } {
    const lineText = document.lineAt(line).text;
    const level = getHeadingLevel(document, lineText);

    if (level === 0) {
        // Not on a heading, find the parent heading
        for (let i = line - 1; i >= 0; i--) {
            if (isHeadingLine(document, document.lineAt(i).text)) {
                return getSubtreeRange(document, i);
            }
        }
        return { startLine: line, endLine: line };
    }

    let endLine = line;

    // Find end of subtree (next heading at same or higher level, or end of file)
    for (let i = line + 1; i < document.lineCount; i++) {
        const nextLevel = getHeadingLevel(document, document.lineAt(i).text);
        if (nextLevel > 0 && nextLevel <= level) {
            break;
        }
        endLine = i;
    }

    return { startLine: line, endLine };
}

/**
 * Move subtree up (swap with previous sibling) - supports org and markdown
 */
export async function moveSubtreeUp(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const current = getSubtreeRange(document, position.line);

    if (current.startLine === 0) {
        vscode.window.showInformationMessage('Already at top');
        return;
    }

    // Get the level of current heading
    const level = getHeadingLevel(document, document.lineAt(current.startLine).text);

    // Find the previous sibling at the same level
    let prevStart = -1;
    for (let i = current.startLine - 1; i >= 0; i--) {
        const prevLevel = getHeadingLevel(document, document.lineAt(i).text);
        if (prevLevel > 0) {
            if (prevLevel === level) {
                prevStart = i;
                break;
            } else if (prevLevel < level) {
                // Hit a parent heading, no previous sibling
                break;
            }
        }
    }

    if (prevStart === -1) {
        vscode.window.showInformationMessage('No previous sibling to swap with');
        return;
    }

    // Get the previous subtree range
    const prev = getSubtreeRange(document, prevStart);

    // Get both subtrees' text
    const currentText = document.getText(new vscode.Range(current.startLine, 0, current.endLine + 1, 0));
    const prevText = document.getText(new vscode.Range(prev.startLine, 0, prev.endLine + 1, 0));

    // Replace the combined range with swapped content
    const combinedRange = new vscode.Range(prev.startLine, 0, current.endLine + 1, 0);
    const swappedText = currentText + prevText;

    await editor.edit(editBuilder => {
        editBuilder.replace(combinedRange, swappedText);
    });

    // Move cursor with the subtree
    const newLine = prev.startLine + (position.line - current.startLine);
    const newPos = new vscode.Position(newLine, position.character);
    editor.selection = new vscode.Selection(newPos, newPos);
    editor.revealRange(new vscode.Range(newPos, newPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Move subtree down (swap with next sibling) - supports org and markdown
 */
export async function moveSubtreeDown(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const current = getSubtreeRange(document, position.line);

    if (current.endLine >= document.lineCount - 1) {
        vscode.window.showInformationMessage('Already at bottom');
        return;
    }

    // Get the level of current heading
    const level = getHeadingLevel(document, document.lineAt(current.startLine).text);

    // Find the next sibling at the same level
    let nextStart = -1;
    for (let i = current.endLine + 1; i < document.lineCount; i++) {
        const nextLevel = getHeadingLevel(document, document.lineAt(i).text);
        if (nextLevel > 0) {
            if (nextLevel === level) {
                nextStart = i;
                break;
            } else if (nextLevel < level) {
                // Hit a parent heading, no next sibling
                break;
            }
        }
    }

    if (nextStart === -1) {
        vscode.window.showInformationMessage('No next sibling to swap with');
        return;
    }

    // Get the next subtree range
    const next = getSubtreeRange(document, nextStart);

    // Get both subtrees' text
    const currentText = document.getText(new vscode.Range(current.startLine, 0, current.endLine + 1, 0));
    const nextText = document.getText(new vscode.Range(next.startLine, 0, next.endLine + 1, 0));

    // Replace the combined range with swapped content
    const combinedRange = new vscode.Range(current.startLine, 0, next.endLine + 1, 0);
    const swappedText = nextText + currentText;

    await editor.edit(editBuilder => {
        editBuilder.replace(combinedRange, swappedText);
    });

    // Move cursor with the subtree (it moves down by the size of the next subtree)
    const nextLines = next.endLine - next.startLine + 1;
    const newLine = current.startLine + nextLines + (position.line - current.startLine);
    const newPos = new vscode.Position(newLine, position.character);
    editor.selection = new vscode.Selection(newPos, newPos);
    editor.revealRange(new vscode.Range(newPos, newPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Mark (select) the current subtree
 * This selects the entire subtree so you can cut, copy, or delete it
 */
export async function markSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    // Select from start of heading to end of subtree (including trailing newline if present)
    const startPos = new vscode.Position(startLine, 0);
    const endPos = endLine < document.lineCount - 1
        ? new vscode.Position(endLine + 1, 0)
        : new vscode.Position(endLine, document.lineAt(endLine).text.length);

    editor.selection = new vscode.Selection(startPos, endPos);
    editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Kill (delete) current subtree
 */
export async function killSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    // Copy to clipboard first
    const subtreeRange = new vscode.Range(startLine, 0, endLine + 1, 0);
    const subtreeText = document.getText(subtreeRange);
    await vscode.env.clipboard.writeText(subtreeText);

    await editor.edit(editBuilder => {
        editBuilder.delete(subtreeRange);
    });

    vscode.window.showInformationMessage('Subtree killed and copied to clipboard');
}

/**
 * Clone (copy) current subtree below
 */
export async function cloneSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    const subtreeRange = new vscode.Range(startLine, 0, endLine + 1, 0);
    const subtreeText = document.getText(subtreeRange);

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(endLine + 1, 0), subtreeText);
    });
}

/**
 * Insert a new heading respecting current context
 */
export async function insertHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const headingPattern = getHeadingPattern(document);
    const headingChar = getHeadingChar(document);

    // Find the current heading level
    let level = 1;
    for (let i = position.line; i >= 0; i--) {
        const match = document.lineAt(i).text.match(headingPattern);
        if (match) {
            level = match[1].length;
            break;
        }
    }

    const heading = '\n' + headingChar.repeat(level) + ' ';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, document.lineAt(position.line).text.length), heading);
    });

    const newPos = new vscode.Position(position.line + 1, level + 1);
    editor.selection = new vscode.Selection(newPos, newPos);
}

/**
 * Insert a new subheading (one level deeper)
 */
export async function insertSubheading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const headingPattern = getHeadingPattern(document);
    const headingChar = getHeadingChar(document);

    // Find the current heading level
    let level = 1;
    for (let i = position.line; i >= 0; i--) {
        const match = document.lineAt(i).text.match(headingPattern);
        if (match) {
            level = match[1].length + 1;
            break;
        }
    }

    const heading = '\n' + headingChar.repeat(level) + ' ';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, document.lineAt(position.line).text.length), heading);
    });

    const newPos = new vscode.Position(position.line + 1, level + 1);
    editor.selection = new vscode.Selection(newPos, newPos);
}

/**
 * Insert an inline task at the current position
 * Inline tasks use 15 stars (the default inlinetask-min-level)
 */
export async function insertInlineTask(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);

    // Inline tasks use 15 stars by default
    const stars = '*'.repeat(15);
    const taskLine = `${stars} TODO `;
    const endLine = `${stars} END`;

    // Insert at end of current line or on new line if line has content
    const insertText = line.text.trim() === ''
        ? `${taskLine}\n${endLine}`
        : `\n${taskLine}\n${endLine}`;

    const insertPos = line.text.trim() === ''
        ? new vscode.Position(position.line, 0)
        : new vscode.Position(position.line, line.text.length);

    await editor.edit(editBuilder => {
        editBuilder.insert(insertPos, insertText);
    });

    // Position cursor after "TODO "
    const newLine = line.text.trim() === '' ? position.line : position.line + 1;
    const cursorCol = stars.length + 6; // "*************** TODO " = 15 + 6
    const newPos = new vscode.Position(newLine, cursorCol);
    editor.selection = new vscode.Selection(newPos, newPos);
}

// =============================================================================
// TODO/Checkbox Functions
// =============================================================================

/**
 * Format an inactive timestamp for CLOSED
 */
function formatClosedTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dow = getDayOfWeek(now);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `[${year}-${month}-${day} ${dow} ${hours}:${minutes}]`;
}

/**
 * Find existing CLOSED line for a heading
 * Returns the line number if found, -1 otherwise
 */
function findClosedLine(document: vscode.TextDocument, headingLine: number): number {
    // Look at lines immediately after the heading for CLOSED:
    // Stop at next heading or content that's not a planning line
    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;

        // Check for CLOSED line
        if (lineText.match(/^\s*CLOSED:\s*\[/)) {
            return i;
        }

        // Skip DEADLINE and SCHEDULED lines
        if (lineText.match(/^\s*(DEADLINE|SCHEDULED):/)) {
            continue;
        }

        // Stop at next heading
        if (lineText.match(/^\*+\s/)) {
            break;
        }

        // Stop at non-planning content (property drawers are OK)
        if (lineText.match(/^\s*:/) || lineText.trim() === '') {
            continue;
        }

        // Any other content, stop looking
        break;
    }
    return -1;
}

/**
 * Update CLOSED timestamp when transitioning TODO states
 * @param editor The active text editor
 * @param headingLine The line number of the heading
 * @param wasInDoneState Whether the previous state was a done state
 * @param isNowInDoneState Whether the new state is a done state
 */
export async function updateClosedTimestamp(
    editor: vscode.TextEditor,
    headingLine: number,
    wasInDoneState: boolean,
    isNowInDoneState: boolean
): Promise<void> {
    const document = editor.document;
    const existingClosedLine = findClosedLine(document, headingLine);

    if (isNowInDoneState && !wasInDoneState) {
        // Transitioning TO done state - add CLOSED timestamp
        if (existingClosedLine === -1) {
            // No existing CLOSED, add one after heading
            const headingText = document.lineAt(headingLine).text;
            const indent = headingText.match(/^(\s*)/)?.[1] || '';
            const closedLine = `${indent}CLOSED: ${formatClosedTimestamp()}`;

            // Insert after heading line
            await editor.edit(editBuilder => {
                editBuilder.insert(
                    new vscode.Position(headingLine + 1, 0),
                    closedLine + '\n'
                );
            });
        } else {
            // Update existing CLOSED line
            const lineRange = document.lineAt(existingClosedLine).range;
            const existingText = document.lineAt(existingClosedLine).text;
            const indent = existingText.match(/^(\s*)/)?.[1] || '';
            await editor.edit(editBuilder => {
                editBuilder.replace(lineRange, `${indent}CLOSED: ${formatClosedTimestamp()}`);
            });
        }
    } else if (!isNowInDoneState && wasInDoneState) {
        // Transitioning FROM done state - remove CLOSED timestamp
        if (existingClosedLine !== -1) {
            const lineRange = document.lineAt(existingClosedLine).rangeIncludingLineBreak;
            await editor.edit(editBuilder => {
                editBuilder.delete(lineRange);
            });
        }
    }
}

/**
 * Find DEADLINE or SCHEDULED with repeater for a heading
 * Only looks at lines immediately after the heading (before next heading or content)
 */
function findRepeaterForHeading(
    document: vscode.TextDocument,
    headingLine: number
): { lineNumber: number; match: RegExpMatchArray; type: 'DEADLINE' | 'SCHEDULED' } | null {
    // Extract lines from heading to next heading (or up to 10 lines)
    const lines: string[] = [];
    for (let i = headingLine; i < document.lineCount && lines.length < 10; i++) {
        const lineText = document.lineAt(i).text;
        lines.push(lineText);
        // Stop at next heading (but include the first line which is the current heading)
        if (i > headingLine && /^\*+\s/.test(lineText)) {
            lines.pop(); // Don't include the next heading
            break;
        }
    }

    const result = findRepeaterInLines(lines, 0);
    if (!result) return null;

    return {
        lineNumber: headingLine + result.lineIndex,
        match: result.match,
        type: result.type
    };
}

/**
 * Cycle TODO state on current heading
 * Uses file-specific TODO states from #+TODO: keywords if defined
 */
export async function cycleTodoState(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Get TODO workflow for this document
    const workflow = getTodoWorkflowForDocument(document);
    const doneStates = new Set(workflow.doneStates);

    // Get all recognized TODO states for this document
    const allStates = getAllTodoStatesForDocument(document);
    const statesPattern = Array.from(allStates)
        .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    // Build dynamic regex to match heading with any recognized TODO state
    const headingRegex = new RegExp(`^(\\*+)\\s+(${statesPattern})?\\s*(.*)`);
    const headingMatch = lineText.match(headingRegex);

    if (!headingMatch) {
        // Try simpler match for headings without TODO states
        const simpleMatch = lineText.match(/^(\*+)\s+(.*)/);
        if (!simpleMatch) {
            vscode.window.showInformationMessage('Not on a heading');
            return;
        }
        // Heading without any TODO state
        const [, stars, rest] = simpleMatch;
        const nextState = getNextTodoState(undefined, document);

        const newLine = nextState
            ? `${stars} ${nextState} ${rest}`
            : `${stars} ${rest}`;

        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
        });

        // Handle CLOSED timestamp (was not done, check if now done)
        const isNowDone = doneStates.has(nextState);
        await updateClosedTimestamp(editor, position.line, false, isNowDone);

        await updateStatisticsCookies(editor, position.line, stars.length);
        return;
    }

    const [, stars, currentState, rest] = headingMatch;
    let nextState = getNextTodoState(currentState, document);

    // Determine done state transitions
    const wasDone = currentState ? doneStates.has(currentState) : false;
    const isNowDone = nextState ? doneStates.has(nextState) : false;

    // Check for repeater when transitioning TO done state
    let repeaterInfo: ReturnType<typeof findRepeaterForHeading> = null;
    if (isNowDone && !wasDone) {
        repeaterInfo = findRepeaterForHeading(document, position.line);
    }

    if (repeaterInfo) {
        // This is a repeating task - advance the timestamp and reset to first active state
        const match = repeaterInfo.match;
        const year = parseInt(match[3]);
        const month = parseInt(match[4]);
        const day = parseInt(match[5]);
        const hour = match[6] ? parseInt(match[6]) : undefined;
        const minute = match[7] ? parseInt(match[7]) : undefined;
        const repeater = match[8];

        // Advance the date
        const newDate = advanceDateByRepeater(year, month, day, repeater);

        // Build new timestamp
        const newTimestamp = formatOrgTimestamp(newDate, {
            hour,
            minute,
            repeater,
            active: true
        });

        // Build the new DEADLINE/SCHEDULED line
        const indent = match[1];
        const keyword = match[2];
        const newDeadlineLine = `${indent}${keyword}: ${newTimestamp}`;

        // Reset to first active state instead of done state
        nextState = workflow.activeStates[0] || 'TODO';

        const newLine = `${stars} ${nextState} ${rest}`;

        // Apply both edits: update heading and timestamp
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
            editBuilder.replace(
                document.lineAt(repeaterInfo!.lineNumber).range,
                newDeadlineLine
            );
        });

        // Don't add CLOSED for repeating tasks
        await updateStatisticsCookies(editor, position.line, stars.length);
        return;
    }

    // Non-repeating task - normal TODO cycling
    const newLine = nextState
        ? `${stars} ${nextState} ${rest}`
        : `${stars} ${rest}`;

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, newLine);
    });

    // Handle CLOSED timestamp
    await updateClosedTimestamp(editor, position.line, wasDone, isNowDone);

    // Update statistics cookies in parent headings
    await updateStatisticsCookies(editor, position.line, stars.length);
}

/**
 * Update statistics cookies [n/m] or [n%] in parent headings
 * Exported for use by other modules (e.g., timestampProvider)
 * Uses file-specific TODO states from #+TODO: keywords if defined
 */
export async function updateStatisticsCookies(
    editor: vscode.TextEditor,
    changedLine: number,
    changedLevel: number
): Promise<void> {
    const document = editor.document;
    const workflow = getTodoWorkflowForDocument(document);
    const doneStates = new Set(workflow.doneStates);
    const todoStates = new Set(workflow.activeStates);

    // Find parent heading (lower level number = higher in hierarchy)
    let parentLine = -1;
    let parentLevel = changedLevel;

    for (let i = changedLine - 1; i >= 0; i--) {
        const line = document.lineAt(i).text;
        const match = line.match(/^(\*+)\s+/);
        if (match && match[1].length < parentLevel) {
            parentLine = i;
            parentLevel = match[1].length;
            break;
        }
    }

    if (parentLine < 0) return;

    const parentText = document.lineAt(parentLine).text;

    // Check if parent has a statistics cookie
    const cookieMatch = parentText.match(/\[(\d+)\/(\d+)\]|\[(\d+)%\]/);
    if (!cookieMatch) return;

    // Count children at the level directly below parent
    const childLevel = parentLevel + 1;
    let doneCount = 0;
    let totalCount = 0;

    // Find the end of this parent's subtree
    let endLine = document.lineCount;
    for (let i = parentLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(/^(\*+)\s+/);
        if (match && match[1].length <= parentLevel) {
            endLine = i;
            break;
        }
    }

    // Build dynamic regex for matching TODO states
    const allStates = getAllTodoStatesForDocument(document);
    const statesPattern = Array.from(allStates)
        .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const headingWithStateRegex = new RegExp(`^(\\*+)\\s+(${statesPattern})?\\s*`);

    // Count direct children with TODO states
    for (let i = parentLine + 1; i < endLine; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(headingWithStateRegex);
        if (match && match[1].length === childLevel) {
            const state = match[2];
            if (state) {
                totalCount++;
                if (doneStates.has(state)) {
                    doneCount++;
                }
            } else if (todoStates.has('') === false) {
                // Headings without TODO state can be counted if they exist
                // but typically we only count those with explicit states
            }
        }
    }

    // Also count plain headings as part of total if cookie exists
    // Re-scan to include all direct child headings
    totalCount = 0;
    doneCount = 0;
    for (let i = parentLine + 1; i < endLine; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(headingWithStateRegex);
        if (match && match[1].length === childLevel) {
            totalCount++;
            const state = match[2];
            if (state && doneStates.has(state)) {
                doneCount++;
            }
        }
    }

    if (totalCount === 0) return;

    // Build new cookie
    let newCookie: string;
    if (cookieMatch[3] !== undefined) {
        // Percentage format [n%]
        const percent = Math.round((doneCount / totalCount) * 100);
        newCookie = `[${percent}%]`;
    } else {
        // Fraction format [n/m]
        newCookie = `[${doneCount}/${totalCount}]`;
    }

    // Replace the cookie in the parent line
    const newParentText = parentText.replace(/\[\d+\/\d+\]|\[\d+%\]/, newCookie);

    if (newParentText !== parentText) {
        await editor.edit(editBuilder => {
            const parentRange = document.lineAt(parentLine).range;
            editBuilder.replace(parentRange, newParentText);
        });

        // Recursively update parent's parent
        await updateStatisticsCookies(editor, parentLine, parentLevel);
    }
}

/**
 * Update statistics cookie at the current heading
 * Called when C-c C-c is pressed on a heading with [n/m] or [n%]
 */
export async function updateStatisticsAtCursor(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;

    // Check if we're on a heading with a statistics cookie
    const headingMatch = lineText.match(/^(\*+)\s+/);
    if (!headingMatch) return false;

    const cookieMatch = lineText.match(/\[(\d+)\/(\d+)\]|\[(\d+)%\]/);
    if (!cookieMatch) return false;

    const level = headingMatch[1].length;
    const workflow = getTodoWorkflowForDocument(document);
    const doneStates = new Set(workflow.doneStates);

    // Find the end of this heading's subtree
    let endLine = document.lineCount;
    for (let i = position.line + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(/^(\*+)\s+/);
        if (match && match[1].length <= level) {
            endLine = i;
            break;
        }
    }

    // Build dynamic regex for matching TODO states
    const allStates = getAllTodoStatesForDocument(document);
    const statesPattern = Array.from(allStates)
        .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const headingWithStateRegex = new RegExp(`^(\\*+)\\s+(${statesPattern})?\\s*`);

    // Count direct children at the level directly below
    const childLevel = level + 1;
    let doneCount = 0;
    let totalCount = 0;

    for (let i = position.line + 1; i < endLine; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(headingWithStateRegex);
        if (match && match[1].length === childLevel) {
            totalCount++;
            const state = match[2];
            if (state && doneStates.has(state)) {
                doneCount++;
            }
        }
    }

    if (totalCount === 0) {
        vscode.window.showInformationMessage('No child headings found to count');
        return true;
    }

    // Build new cookie
    let newCookie: string;
    if (cookieMatch[3] !== undefined) {
        // Percentage format [n%]
        const percent = Math.round((doneCount / totalCount) * 100);
        newCookie = `[${percent}%]`;
    } else {
        // Fraction format [n/m]
        newCookie = `[${doneCount}/${totalCount}]`;
    }

    // Replace the cookie in the heading
    const newLineText = lineText.replace(/\[\d+\/\d+\]|\[\d+%\]/, newCookie);

    if (newLineText !== lineText) {
        await editor.edit(editBuilder => {
            const lineRange = document.lineAt(position.line).range;
            editBuilder.replace(lineRange, newLineText);
        });
        vscode.window.showInformationMessage(`Updated: ${newCookie}`);
    } else {
        vscode.window.showInformationMessage(`Statistics already current: ${newCookie}`);
    }

    return true;
}

/**
 * Check if a list has the radio attribute (#+attr_org: :radio t)
 * The attribute must be directly above the first list item (no blank lines)
 * Returns true if the list containing the given line is a radio list
 */
function isRadioList(document: vscode.TextDocument, lineNumber: number): boolean {
    const lineText = document.lineAt(lineNumber).text;

    // Get the indentation level of the current checkbox
    const indentMatch = lineText.match(/^(\s*)/);
    const baseIndent = indentMatch ? indentMatch[1].length : 0;

    // First, find the first item of this list (search backwards for list items at same indent)
    let firstListItemLine = lineNumber;
    for (let i = lineNumber - 1; i >= 0; i--) {
        const prevLine = document.lineAt(i).text;

        // Stop at blank lines or headings
        if (prevLine.trim() === '' || /^(\*+)\s+/.test(prevLine)) {
            break;
        }

        // Skip attribute lines
        if (/^\s*#\+/.test(prevLine)) {
            continue;
        }

        // Check if it's a list item at the same indentation level
        const listMatch = prevLine.match(/^(\s*)([-+*]|\d+[.)])\s+/);
        if (listMatch) {
            const prevIndent = listMatch[1].length;
            if (prevIndent === baseIndent) {
                firstListItemLine = i;
            } else if (prevIndent < baseIndent) {
                // Hit a parent list item, stop
                break;
            }
        }
    }

    // Now check if there's #+attr_org: :radio t directly above the first list item
    // (allowing for multiple attribute lines but no blank lines)
    for (let i = firstListItemLine - 1; i >= 0; i--) {
        const prevLine = document.lineAt(i).text;

        // Check for attr_org with radio attribute
        if (/^\s*#\+attr_org:.*:radio\s+t/i.test(prevLine)) {
            return true;
        }

        // If it's another attribute line, keep looking
        if (/^\s*#\+/.test(prevLine)) {
            continue;
        }

        // Any other content (blank line, heading, text, list item) means no radio attribute
        break;
    }

    return false;
}

/**
 * Find all checkbox lines in the same list as the given line
 * Returns line numbers of all checkboxes at the same or deeper indentation level
 */
function findCheckboxesInList(document: vscode.TextDocument, lineNumber: number): number[] {
    const checkboxLines: number[] = [];
    const lineText = document.lineAt(lineNumber).text;

    // Get the indentation level of the current checkbox
    const indentMatch = lineText.match(/^(\s*)/);
    const baseIndent = indentMatch ? indentMatch[1].length : 0;

    // Find the start of the list (search backwards)
    let listStart = lineNumber;
    for (let i = lineNumber - 1; i >= 0; i--) {
        const prevLine = document.lineAt(i).text;

        // Stop at blank lines, headings, or attr lines
        if (prevLine.trim() === '' || /^(\*+)\s+/.test(prevLine) || /^\s*#\+/.test(prevLine)) {
            listStart = i + 1;
            break;
        }

        // Check if it's a list item
        const listMatch = prevLine.match(/^(\s*)([-+*]|\d+[.)])\s+/);
        if (listMatch) {
            const prevIndent = listMatch[1].length;
            if (prevIndent < baseIndent) {
                // Parent list item - stop here
                listStart = i + 1;
                break;
            }
        }

        if (i === 0) {
            listStart = 0;
        }
    }

    // Find the end of the list and collect checkboxes (search forwards)
    for (let i = listStart; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;

        // Stop at blank lines or headings
        if (line.trim() === '' || /^(\*+)\s+/.test(line)) {
            break;
        }

        // Skip attr lines
        if (/^\s*#\+/.test(line)) {
            continue;
        }

        // Check for checkbox
        const checkboxMatch = line.match(/^(\s*)([-+*]|\d+[.)])\s+\[([ Xx-])\]/);
        if (checkboxMatch) {
            const itemIndent = checkboxMatch[1].length;
            // Include checkboxes at the same indentation level
            if (itemIndent === baseIndent) {
                checkboxLines.push(i);
            }
        }
    }

    return checkboxLines;
}

/**
 * Toggle checkbox at point
 * Supports radio lists where only one item can be checked (#+attr_org: :radio t)
 */
export async function toggleCheckbox(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;

    console.log(`[toggleCheckbox] Called at line ${position.line}: "${lineText.substring(0, 50)}..."`);

    // Match checkbox: - [ ], - [X], - [-]
    const checkboxMatch = lineText.match(/^(\s*[-+*]|\s*\d+[.)])\s+\[([ Xx-])\]\s+(.*)$/);
    if (!checkboxMatch) {
        console.log(`[toggleCheckbox] Not a checkbox, showing message`);
        vscode.window.showInformationMessage('Not on a checkbox');
        return;
    }

    const [, bullet, state, content] = checkboxMatch;
    const newState = state === ' ' ? 'X' : ' ';
    const newLine = `${bullet} [${newState}] ${content}`;

    // Check if this is a radio list
    const isRadio = isRadioList(document, position.line);

    if (isRadio && newState === 'X') {
        // Radio list: uncheck all other checkboxes first, then check this one
        const checkboxLines = findCheckboxesInList(document, position.line);

        await editor.edit(editBuilder => {
            for (const checkboxLine of checkboxLines) {
                if (checkboxLine === position.line) {
                    // Check the current checkbox
                    editBuilder.replace(line.range, newLine);
                } else {
                    // Uncheck other checkboxes
                    const otherLine = document.lineAt(checkboxLine);
                    const otherText = otherLine.text;
                    const otherMatch = otherText.match(/^(\s*[-+*]|\s*\d+[.)])\s+\[([ Xx-])\]\s+(.*)$/);
                    if (otherMatch && otherMatch[2].toLowerCase() === 'x') {
                        const [, otherBullet, , otherContent] = otherMatch;
                        const uncheckedLine = `${otherBullet} [ ] ${otherContent}`;
                        editBuilder.replace(otherLine.range, uncheckedLine);
                    }
                }
            }
        });
    } else {
        // Regular checkbox or unchecking in radio list
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
        });
    }

    // Update checkbox statistics cookies in parent heading
    await updateCheckboxStatistics(editor, position.line);
}

/**
 * Toggle checkbox at a specific line (for click handling)
 * This is called when user clicks on a checkbox
 */
export async function toggleCheckboxAt(uri: vscode.Uri, lineNumber: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    // Move cursor to the line
    const position = new vscode.Position(lineNumber, 0);
    editor.selection = new vscode.Selection(position, position);

    // Now call the regular toggle function
    await toggleCheckbox();
}

/**
 * Update checkbox statistics cookies [n/m] or [n%] in parent heading or list item
 */
async function updateCheckboxStatistics(
    editor: vscode.TextEditor,
    changedLine: number
): Promise<void> {
    const document = editor.document;
    const changedLineText = document.lineAt(changedLine).text;

    // Get the indentation of the changed checkbox
    const indentMatch = changedLineText.match(/^(\s*)/);
    const checkboxIndent = indentMatch ? indentMatch[1].length : 0;

    // First, look for a parent list item with a statistics cookie (less indented)
    let parentLine = -1;
    let parentType: 'list' | 'heading' = 'heading';

    for (let i = changedLine - 1; i >= 0; i--) {
        const line = document.lineAt(i).text;

        // Check for heading
        if (line.match(/^(\*+)\s+/)) {
            // Check if it has a statistics cookie
            if (/\[\d+\/\d+\]|\[\d+%\]/.test(line)) {
                parentLine = i;
                parentType = 'heading';
            }
            break; // Stop at heading regardless
        }

        // Check for parent list item (less indented, with statistics cookie)
        const listMatch = line.match(/^(\s*)([-+*]|\d+[.)])\s+/);
        if (listMatch) {
            const listIndent = listMatch[1].length;
            if (listIndent < checkboxIndent && /\[\d+\/\d+\]|\[\d+%\]/.test(line)) {
                parentLine = i;
                parentType = 'list';
                break;
            }
        }
    }

    if (parentLine < 0) return;

    const parentText = document.lineAt(parentLine).text;
    const parentIndentMatch = parentText.match(/^(\s*)/);
    const parentIndent = parentIndentMatch ? parentIndentMatch[1].length : 0;

    // Find the end of the parent's content
    let endLine = document.lineCount;
    for (let i = parentLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;

        // Stop at headings
        if (line.match(/^(\*+)\s+/)) {
            endLine = i;
            break;
        }

        // For list items, stop at blank lines or items at same/lower indent level
        if (parentType === 'list') {
            if (line.trim() === '') {
                endLine = i;
                break;
            }
            const listMatch = line.match(/^(\s*)([-+*]|\d+[.)])\s+/);
            if (listMatch) {
                const lineIndent = listMatch[1].length;
                if (lineIndent <= parentIndent) {
                    endLine = i;
                    break;
                }
            }
        }
    }

    // Count direct child checkboxes (one level deeper than parent)
    let checkedCount = 0;
    let totalCount = 0;
    const targetIndent = parentType === 'list' ? parentIndent + 2 : -1; // For lists, check indent

    for (let i = parentLine + 1; i < endLine; i++) {
        const line = document.lineAt(i).text;
        const checkboxMatch = line.match(/^(\s*)([-+*]|\d+[.)])\s+\[([ Xx-])\]/);
        if (checkboxMatch) {
            const itemIndent = checkboxMatch[1].length;
            // For list parent, only count direct children (specific indent level)
            // For heading parent, count all checkboxes
            if (parentType === 'heading' || itemIndent === targetIndent ||
                (parentType === 'list' && itemIndent > parentIndent)) {
                // Only count direct children for list parents
                if (parentType === 'list' && itemIndent !== parentIndent + 2) {
                    continue;
                }
                totalCount++;
                if (checkboxMatch[3].toLowerCase() === 'x') {
                    checkedCount++;
                }
            }
        }
    }

    if (totalCount === 0) return;

    // Build new cookie
    const cookieMatch = parentText.match(/\[(\d+)\/(\d+)\]|\[(\d+)%\]/);
    if (!cookieMatch) return;

    let newCookie: string;
    if (cookieMatch[3] !== undefined) {
        // Percentage format [n%]
        const percent = Math.round((checkedCount / totalCount) * 100);
        newCookie = `[${percent}%]`;
    } else {
        // Fraction format [n/m]
        newCookie = `[${checkedCount}/${totalCount}]`;
    }

    // Replace the cookie in the parent line
    const newParentText = parentText.replace(/\[\d+\/\d+\]|\[\d+%\]/, newCookie);

    if (newParentText !== parentText) {
        await editor.edit(editBuilder => {
            const parentRange = document.lineAt(parentLine).range;
            editBuilder.replace(parentRange, newParentText);
        });
    }
}

/**
 * Insert a new checkbox item
 */
export async function insertCheckbox(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Detect current indentation
    const indentMatch = lineText.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    const checkbox = `\n${indent}- [ ] `;

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, line.text.length), checkbox);
    });

    const newPos = new vscode.Position(position.line + 1, indent.length + 6);
    editor.selection = new vscode.Selection(newPos, newPos);
}

// =============================================================================
// List Functions
// =============================================================================

/**
 * Check if cursor is on an ordered list item
 */
export function isOnOrderedListItem(document: vscode.TextDocument, line: number): boolean {
    const lineText = document.lineAt(line).text;
    return /^\s*\d+[.)]\s/.test(lineText);
}

/**
 * Check if cursor is on any list item (ordered or unordered)
 */
export function isOnListItem(document: vscode.TextDocument, line: number): boolean {
    const lineText = document.lineAt(line).text;
    return /^\s*(?:[-+*]|\d+[.)])\s/.test(lineText);
}

/**
 * Find the start and end of an ordered list containing the given line
 */
function findOrderedListBounds(document: vscode.TextDocument, line: number): { start: number; end: number } | null {
    const lineText = document.lineAt(line).text;

    // Check if current line is an ordered list item
    if (!/^\s*\d+[.)]\s/.test(lineText)) {
        return null;
    }

    // Get the indentation of the current item
    const currentIndent = lineText.match(/^(\s*)/)?.[1].length ?? 0;

    // Find start of list (search backwards)
    let start = line;
    for (let i = line - 1; i >= 0; i--) {
        const text = document.lineAt(i).text;

        // Empty line might end list section
        if (text.trim() === '') {
            // Check if previous line continues the list
            if (i > 0) {
                const prevText = document.lineAt(i - 1).text;
                const prevIndent = prevText.match(/^(\s*)/)?.[1].length ?? 0;
                if (/^\s*\d+[.)]\s/.test(prevText) && prevIndent === currentIndent) {
                    continue; // Skip blank line within list
                }
            }
            break;
        }

        // Check for ordered list item at same indentation
        const match = text.match(/^(\s*)\d+[.)]\s/);
        if (match && match[1].length === currentIndent) {
            start = i;
            continue;
        }

        // Check for continuation (more indented content)
        const indent = text.match(/^(\s*)/)?.[1].length ?? 0;
        if (indent > currentIndent) {
            continue; // Part of previous item's content
        }

        // Different structure, stop
        break;
    }

    // Find end of list (search forwards)
    let end = line;
    for (let i = line + 1; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;

        // Empty line might end list
        if (text.trim() === '') {
            // Check if next non-blank continues list
            let j = i + 1;
            while (j < document.lineCount && document.lineAt(j).text.trim() === '') {
                j++;
            }
            if (j < document.lineCount) {
                const nextText = document.lineAt(j).text;
                const nextIndent = nextText.match(/^(\s*)/)?.[1].length ?? 0;
                if (/^\s*\d+[.)]\s/.test(nextText) && nextIndent === currentIndent) {
                    i = j - 1; // Will be incremented
                    continue;
                }
            }
            break;
        }

        // Check for ordered list item at same indentation
        const match = text.match(/^(\s*)\d+[.)]\s/);
        if (match && match[1].length === currentIndent) {
            end = i;
            continue;
        }

        // Check for continuation (more indented content)
        const indent = text.match(/^(\s*)/)?.[1].length ?? 0;
        if (indent > currentIndent) {
            end = i; // Part of current item's content
            continue;
        }

        // Different structure, stop
        break;
    }

    return { start, end };
}

/**
 * Renumber an ordered list
 * Fixes the numbers to be sequential starting from 1
 */
export async function renumberList(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find list bounds
    const bounds = findOrderedListBounds(document, position.line);
    if (!bounds) {
        vscode.window.showInformationMessage('Not on an ordered list item');
        return;
    }

    // Get indentation level of list items
    const firstItemText = document.lineAt(bounds.start).text;
    const listIndent = firstItemText.match(/^(\s*)/)?.[1].length ?? 0;

    // Detect the separator style (. or ))
    const separatorMatch = firstItemText.match(/^\s*\d+([.)]\s)/);
    const separator = separatorMatch ? separatorMatch[1] : '. ';

    // Collect all edits
    const edits: { range: vscode.Range; newText: string }[] = [];
    let counter = 1;

    for (let i = bounds.start; i <= bounds.end; i++) {
        const lineText = document.lineAt(i).text;
        const match = lineText.match(/^(\s*)(\d+)([.)]\s)(.*)/);

        if (match) {
            const [, indent, , sep, rest] = match;

            // Only renumber items at the same indentation level
            if (indent.length === listIndent) {
                const newLine = `${indent}${counter}${sep}${rest}`;
                if (newLine !== lineText) {
                    edits.push({
                        range: document.lineAt(i).range,
                        newText: newLine
                    });
                }
                counter++;
            }
        }
    }

    if (edits.length === 0) {
        vscode.window.showInformationMessage('List is already correctly numbered');
        return;
    }

    // Apply all edits
    await editor.edit(editBuilder => {
        for (const edit of edits) {
            editBuilder.replace(edit.range, edit.newText);
        }
    });

    vscode.window.showInformationMessage(`Renumbered ${counter - 1} list items`);
}

/**
 * Setup list context tracking
 */
export function setupListContext(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            if (editor.document.languageId !== 'org') {
                vscode.commands.executeCommand('setContext', 'scimax.inOrderedList', false);
                return;
            }

            const position = editor.selection.active;
            const onOrderedList = isOnOrderedListItem(editor.document, position.line);
            vscode.commands.executeCommand('setContext', 'scimax.inOrderedList', onOrderedList);
        })
    );
}

/**
 * Setup dynamic block context tracking
 */
export function setupDynamicBlockContext(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            if (editor.document.languageId !== 'org') {
                vscode.commands.executeCommand('setContext', 'scimax.inDynamicBlock', false);
                return;
            }

            const position = editor.selection.active;
            const inBlock = isInDynamicBlock(editor.document, position);
            vscode.commands.executeCommand('setContext', 'scimax.inDynamicBlock', inBlock);
        })
    );
}

// =============================================================================
// Link Functions
// =============================================================================

/**
 * Stored link for org-store-link / org-insert-link workflow
 * Stores both full path (for cross-file) and fuzzy link (for same-file)
 */
let storedLink: {
    filePath: string;      // Full path to source file
    fuzzyLink: string;     // Link without file path (e.g., "*Heading", "#custom-id")
    fullLink: string;      // Full link with file (e.g., "file:name.org::*Heading")
    description: string;   // Description for the link
} | null = null;

/**
 * Store a link based on context at point (like org-store-link)
 * - On a heading: stores [[*heading]] / [[file:path::*heading]]
 * - On #+NAME: line: stores [[block-name]] / [[file:path::block-name]]
 * - Near CUSTOM_ID: stores [[#id]] / [[file:path::#id]]
 * - At line start: stores line number
 * - Mid-line: stores line:column
 */
export async function storeLink(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;
    const filePath = document.uri.fsPath;
    const fileName = filePath.split('/').pop() || filePath;

    // Check if on a heading - extract title without TODO state, priority, or tags
    const headingMatch = lineText.match(/^(\*+)\s+(.+?)(?:\s+:[\w:]+:\s*)?$/);
    if (headingMatch) {
        let headingTitle = headingMatch[2].trim();
        // Strip TODO keyword (any all-caps word at start)
        headingTitle = headingTitle.replace(/^[A-Z]+\s+/, '');
        // Strip priority like [#A]
        headingTitle = headingTitle.replace(/^\[#[A-Z]\]\s*/, '');
        headingTitle = headingTitle.trim();
        storedLink = {
            filePath,
            fuzzyLink: `*${headingTitle}`,
            fullLink: `file:${fileName}::*${headingTitle}`,
            description: headingTitle
        };
        vscode.window.showInformationMessage(`Stored link: [[*${headingTitle}]]`);
        return;
    }

    // Check if on a named source block
    const namedBlockMatch = lineText.match(/^#\+NAME:\s*(.+)$/i);
    if (namedBlockMatch) {
        const blockName = namedBlockMatch[1].trim();
        storedLink = {
            filePath,
            fuzzyLink: blockName,
            fullLink: `file:${fileName}::${blockName}`,
            description: blockName
        };
        vscode.window.showInformationMessage(`Stored link: [[${blockName}]]`);
        return;
    }

    // Check if there's a CUSTOM_ID property nearby (search up to find heading with CUSTOM_ID)
    for (let i = position.line; i >= 0; i--) {
        const line = document.lineAt(i).text;
        if (line.match(/^\*+\s/)) {
            // Found parent heading, check for CUSTOM_ID in properties
            for (let j = i + 1; j < Math.min(i + 10, document.lineCount); j++) {
                const propLine = document.lineAt(j).text;
                if (propLine.match(/^\*+\s/) || propLine.trim() === '') break;
                const customIdMatch = propLine.match(/:CUSTOM_ID:\s*(.+)/i);
                if (customIdMatch) {
                    const customId = customIdMatch[1].trim();
                    storedLink = {
                        filePath,
                        fuzzyLink: `#${customId}`,
                        fullLink: `file:${fileName}::#${customId}`,
                        description: customId
                    };
                    vscode.window.showInformationMessage(`Stored link: [[#${customId}]]`);
                    return;
                }
                if (propLine.includes(':END:')) break;
            }
            break;
        }
    }

    // Default: store file with line number or character offset
    // Note: Line/char links always need file: prefix - no fuzzy equivalent exists
    const lineNum = position.line + 1;
    const charNum = position.character;

    if (charNum === 0) {
        // At beginning of line - just use line number
        const link = `file:${fileName}::${lineNum}`;
        storedLink = {
            filePath,
            fuzzyLink: link,  // No fuzzy equivalent for line numbers
            fullLink: link,
            description: `${fileName}:${lineNum}`
        };
        vscode.window.showInformationMessage(`Stored link: [[${link}]]`);
    } else {
        // Mid-line - use character offset from beginning of file
        const charOffset = document.offsetAt(position);
        const link = `file:${fileName}::c${charOffset}`;
        storedLink = {
            filePath,
            fuzzyLink: link,  // No fuzzy equivalent for char offset
            fullLink: link,
            description: `${fileName}:${lineNum}:${charNum}`
        };
        vscode.window.showInformationMessage(`Stored link: [[${link}]]`);
    }
}

/**
 * Get the currently stored link (for use by insertLink)
 */
export function getStoredLink(): typeof storedLink {
    return storedLink;
}

/**
 * Clear the stored link
 */
export function clearStoredLink(): void {
    storedLink = null;
}

/**
 * Insert an org link
 * If a link was previously stored with storeLink, offers to use it
 * Uses fuzzy link syntax when inserting in the same file
 */
export async function insertLink(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let url: string | undefined;
    let description: string | undefined;

    // If we have a stored link, offer to use it
    if (storedLink) {
        // Determine if we're in the same file
        const currentFilePath = editor.document.uri.fsPath;
        const isSameFile = currentFilePath === storedLink.filePath;

        // Use fuzzy link for same file, full link for different file
        const linkToUse = isSameFile ? storedLink.fuzzyLink : storedLink.fullLink;
        const displayLink = isSameFile ? `[[${storedLink.fuzzyLink}]]` : `[[${storedLink.fullLink}]]`;

        const choice = await vscode.window.showQuickPick(
            [
                { label: 'Use stored link', description: displayLink, value: 'stored' },
                { label: 'Enter new link', description: 'Type a URL or path', value: 'new' }
            ],
            { placeHolder: 'Insert link' }
        );

        if (!choice) return;

        if (choice.value === 'stored') {
            url = linkToUse;
            description = storedLink.description;
            // Clear the stored link after use
            storedLink = null;
        }
    }

    if (!url) {
        url = await vscode.window.showInputBox({
            prompt: 'Enter URL or path',
            placeHolder: 'https://example.com or ./file.org'
        });

        if (!url) return;

        description = await vscode.window.showInputBox({
            prompt: 'Enter description (optional)',
            placeHolder: 'Link description'
        });
    }

    const link = description ? `[[${url}][${description}]]` : `[[${url}]]`;

    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, link);
    });
}

/**
 * Check if cursor is on a link and return the link info
 */
export function getLinkAtPoint(document: vscode.TextDocument, position: vscode.Position): { url: string; start: number; end: number } | null {
    const line = document.lineAt(position.line).text;

    // Link patterns to check
    const patterns = [
        // Org bracket links: [[url]] or [[url][description]]
        /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g,
        // Citation links: cite:key or cite:key1,key2
        /(?<![\\w])(?:cite|citep|citet|citeauthor|citeyear|Citep|Citet|citealp|citealt):[\w:-]+(?:,[\w:-]+)*/g,
        // Bare URLs
        /https?:\/\/[^\s\]>)]+/g,
    ];

    for (const pattern of patterns) {
        pattern.lastIndex = 0; // Reset regex state
        let match;
        while ((match = pattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (position.character >= start && position.character <= end) {
                // Extract the actual URL
                let url = match[1] || match[0]; // match[1] for bracket links, match[0] for others
                return { url, start, end };
            }
        }
    }

    return null;
}

/**
 * Check if cursor is on a link (for context)
 */
export function isOnLink(document: vscode.TextDocument, position: vscode.Position): boolean {
    return getLinkAtPoint(document, position) !== null;
}

/**
 * Delete file link at point and optionally delete the actual file
 */
export async function deleteFileLinkAtPoint(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    const linkInfo = getLinkAtPoint(document, position);
    if (!linkInfo) {
        vscode.window.showInformationMessage('No link at cursor');
        return;
    }

    const url = linkInfo.url;

    // Check if it's a file link
    let filePath: string | undefined;
    if (url.startsWith('file:')) {
        filePath = url.replace(/^file:/, '').split('::')[0]; // Remove search component
    } else if (!url.startsWith('http') && !url.startsWith('*') && !url.startsWith('#') &&
               !url.startsWith('id:') && !url.includes(':')) {
        // Looks like a relative file path
        filePath = url;
    }

    if (!filePath) {
        vscode.window.showInformationMessage('Not a file link');
        return;
    }

    // Resolve to absolute path
    const currentDir = path.dirname(document.uri.fsPath);
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(currentDir, filePath);

    // Check if file exists
    const fs = await import('fs');
    const fileExists = fs.existsSync(absolutePath);

    // Ask user what to do
    const options: string[] = ['Delete link only'];
    if (fileExists) {
        options.unshift('Delete link and file');
    }

    const choice = await vscode.window.showQuickPick(options, {
        placeHolder: fileExists
            ? `Delete [[file:${filePath}]] - file exists at ${absolutePath}`
            : `Delete [[file:${filePath}]] - file does not exist`,
    });

    if (!choice) return;

    // Delete the link text
    const line = position.line;
    const linkRange = new vscode.Range(line, linkInfo.start, line, linkInfo.end);

    await editor.edit(editBuilder => {
        editBuilder.delete(linkRange);
    });

    // Delete the file if requested
    if (choice === 'Delete link and file' && fileExists) {
        try {
            fs.unlinkSync(absolutePath);
            vscode.window.showInformationMessage(`Deleted: ${absolutePath}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to delete file: ${msg}`);
        }
    }
}

/**
 * Open link at point
 */
export async function openLinkAtPoint(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    const linkInfo = getLinkAtPoint(document, position);
    if (!linkInfo) {
        vscode.window.showInformationMessage('No link at cursor');
        return;
    }

    const url = linkInfo.url;

    // Handle different link types
    if (url.startsWith('http://') || url.startsWith('https://')) {
        vscode.env.openExternal(vscode.Uri.parse(url));
    } else if (url.startsWith('file:')) {
        await openFileLink(url, document);
    } else if (url.startsWith('cite:') || url.startsWith('citep:') || url.startsWith('citet:')) {
        // Citation link - trigger citation action
        vscode.commands.executeCommand('scimax.citation.action');
    } else if (url.startsWith('*')) {
        // Internal heading link: [[*Heading]]
        await searchAndJumpToHeading(document, url.slice(1));
    } else if (url.startsWith('#')) {
        // Internal custom ID link: [[#custom-id]]
        await searchAndJumpToCustomId(document, url.slice(1));
    } else if (url.startsWith('id:')) {
        // ID link: [[id:uuid]] - search for :ID: property
        await searchAndJumpToId(url.slice(3));
    } else if (url.includes('::')) {
        // File link with search component but without file: prefix
        // e.g., [[05-links.org::#custom-id]] or [[file.org::*Heading]]
        await openFileLink(url, document);
    } else {
        // Treat as relative file path or internal link (fuzzy match)
        const currentDir = vscode.Uri.joinPath(document.uri, '..');
        const targetUri = vscode.Uri.joinPath(currentDir, url);

        // Check if it's a file that exists
        try {
            await vscode.workspace.fs.stat(targetUri);
            vscode.commands.executeCommand('vscode.open', targetUri);
        } catch {
            // Not a file - try fuzzy search for heading or named element
            await searchAndJumpToTarget(document, url);
        }
    }
}

/**
 * Open a file: link, handling :: search syntax
 * Supports: file:name.org::123 (line), file:name.org::c456 (char offset),
 *           file:name.org::*Heading, file:name.org::#custom-id
 */
async function openFileLink(url: string, currentDocument: vscode.TextDocument): Promise<void> {
    const fileUrl = url.replace(/^file:/, '');

    // Parse the :: search part if present
    const parts = fileUrl.split('::');
    const filePath = parts[0];
    const searchPart = parts[1];

    // Resolve the file path
    let targetUri: vscode.Uri;
    if (filePath.startsWith('/')) {
        targetUri = vscode.Uri.file(filePath);
    } else if (filePath) {
        const currentDir = vscode.Uri.joinPath(currentDocument.uri, '..');
        targetUri = vscode.Uri.joinPath(currentDir, filePath);
    } else {
        // Empty file path means current file
        targetUri = currentDocument.uri;
    }

    // Open the file
    const doc = await vscode.workspace.openTextDocument(targetUri);
    const editor = await vscode.window.showTextDocument(doc);

    // Navigate to the target if specified
    if (searchPart) {
        if (/^c\d+$/.test(searchPart)) {
            // Character offset: ::c1234
            const charOffset = parseInt(searchPart.slice(1), 10);
            const pos = doc.positionAt(charOffset);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        } else if (searchPart.startsWith('*')) {
            // Heading search: ::*Heading Title
            await searchAndJumpToHeading(doc, searchPart.slice(1));
        } else if (searchPart.startsWith('#')) {
            // Custom ID: ::#custom-id
            await searchAndJumpToCustomId(doc, searchPart.slice(1));
        } else if (/^\d+$/.test(searchPart)) {
            // Line number: ::123
            const lineNum = parseInt(searchPart, 10) - 1; // 1-indexed to 0-indexed
            if (lineNum >= 0 && lineNum < doc.lineCount) {
                const pos = new vscode.Position(lineNum, 0);
                editor.selection = new vscode.Selection(pos, pos);
                // Unfold at target line so content is visible
                await vscode.commands.executeCommand('editor.unfold', { selectionLines: [lineNum] });
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
        } else {
            // Fuzzy search for target (named element, etc.)
            await searchAndJumpToTarget(doc, searchPart);
        }
    }
}

/**
 * Search for a heading and jump to it
 * Ignores TODO keywords, priorities, and tags when matching
 */
async function searchAndJumpToHeading(document: vscode.TextDocument, headingTitle: string): Promise<void> {
    const searchText = headingTitle.toLowerCase();

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(/^(\*+)\s+(.+?)(?:\s+:[\w:]+:\s*)?$/);
        if (match) {
            let title = match[2].trim();
            // Strip TODO keyword (any all-caps word at start)
            title = title.replace(/^[A-Z]+\s+/, '');
            // Strip priority like [#A]
            title = title.replace(/^\[#[A-Z]\]\s*/, '');
            title = title.trim().toLowerCase();

            if (title === searchText || title.includes(searchText)) {
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === document) {
                    const pos = new vscode.Position(i, 0);
                    editor.selection = new vscode.Selection(pos, pos);
                    // Unfold at target line so content is visible
                    await vscode.commands.executeCommand('editor.unfold', { selectionLines: [i] });
                    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                    return;
                }
            }
        }
    }
    vscode.window.showWarningMessage(`Heading not found: ${headingTitle}`);
}

/**
 * Search for a custom ID and jump to it
 */
async function searchAndJumpToCustomId(document: vscode.TextDocument, customId: string): Promise<void> {
    const searchId = customId.toLowerCase();

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(/:CUSTOM_ID:\s*(.+)/i);
        if (match && match[1].trim().toLowerCase() === searchId) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === document) {
                const pos = new vscode.Position(i, 0);
                editor.selection = new vscode.Selection(pos, pos);
                // Unfold at target line so content is visible
                await vscode.commands.executeCommand('editor.unfold', { selectionLines: [i] });
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                return;
            }
        }
    }
    vscode.window.showWarningMessage(`Custom ID not found: #${customId}`);
}

/**
 * Search for an ID property and jump to it
 * Searches current document first, then all org files in workspace
 */
async function searchAndJumpToId(id: string): Promise<void> {
    const searchId = id.toLowerCase();

    // Helper function to find ID in a document and navigate to it
    async function findInDocument(doc: vscode.TextDocument): Promise<boolean> {
        for (let i = 0; i < doc.lineCount; i++) {
            const line = doc.lineAt(i).text;
            const match = line.match(/:ID:\s*(.+)/i);
            if (match && match[1].trim().toLowerCase() === searchId) {
                const editor = await vscode.window.showTextDocument(doc);
                // Navigate to the heading above this property
                let headingLine = i;
                for (let j = i - 1; j >= 0; j--) {
                    if (doc.lineAt(j).text.match(/^\*+\s/)) {
                        headingLine = j;
                        break;
                    }
                }
                const pos = new vscode.Position(headingLine, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                return true;
            }
        }
        return false;
    }

    // First, search in the active document
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const found = await findInDocument(activeEditor.document);
        if (found) {
            return;
        }
    }

    // Search across all org files in the workspace
    const orgFiles = await vscode.workspace.findFiles('**/*.org', '**/node_modules/**');

    for (const fileUri of orgFiles) {
        // Skip the active file (already searched)
        if (activeEditor && fileUri.fsPath === activeEditor.document.uri.fsPath) {
            continue;
        }

        try {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            const found = await findInDocument(doc);
            if (found) {
                return;
            }
        } catch {
            // Skip files that can't be opened
            continue;
        }
    }

    vscode.window.showWarningMessage(`ID not found: ${id}`);
}

/**
 * Search for a target (#+NAME:, <<target>>, etc.) and jump to it
 */
async function searchAndJumpToTarget(document: vscode.TextDocument, target: string): Promise<void> {
    const searchTarget = target.toLowerCase();

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;

        // Check for #+NAME:
        const nameMatch = line.match(/^#\+NAME:\s*(.+)$/i);
        if (nameMatch && nameMatch[1].trim().toLowerCase() === searchTarget) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === document) {
                const pos = new vscode.Position(i, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                return;
            }
        }

        // Check for <<target>>
        const targetMatch = line.match(/<<([^>]+)>>/);
        if (targetMatch && targetMatch[1].trim().toLowerCase() === searchTarget) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === document) {
                const pos = new vscode.Position(i, line.indexOf('<<'));
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                return;
            }
        }
    }

    // Fallback: plain text search
    const text = document.getText();
    const index = text.toLowerCase().indexOf(searchTarget);
    if (index !== -1) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document === document) {
            const pos = document.positionAt(index);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showWarningMessage(`Target not found: ${target}`);
}

// =============================================================================
// ID Property Functions
// =============================================================================

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
    // Use crypto.randomUUID if available (Node 19+), otherwise fallback
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback implementation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Add an ID property (UUID) to the current heading
 * If already on a heading with a properties drawer, adds :ID: property
 * If no properties drawer exists, creates one
 */
export async function addIdToHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading for the current position
    let headingLine = -1;
    for (let i = position.line; i >= 0; i--) {
        const line = document.lineAt(i).text;
        if (/^\*+\s/.test(line)) {
            headingLine = i;
            break;
        }
    }

    if (headingLine === -1) {
        vscode.window.showWarningMessage('Not under a heading');
        return;
    }

    const uuid = generateUUID();

    // Check if there's already a properties drawer
    let propertiesStart = -1;
    let propertiesEnd = -1;
    let existingIdLine = -1;

    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;

        // Stop if we hit another heading
        if (/^\*+\s/.test(line)) break;

        // Check for :PROPERTIES:
        if (/^\s*:PROPERTIES:\s*$/i.test(line)) {
            propertiesStart = i;
            continue;
        }

        // Check for :END:
        if (propertiesStart !== -1 && /^\s*:END:\s*$/i.test(line)) {
            propertiesEnd = i;
            break;
        }

        // Check for existing :ID:
        if (propertiesStart !== -1 && /^\s*:ID:\s*/i.test(line)) {
            existingIdLine = i;
        }

        // Stop if we hit content (non-empty line that's not a property)
        if (propertiesStart === -1 && line.trim() !== '' && !line.match(/^\s*:/)) {
            break;
        }
    }

    await editor.edit(editBuilder => {
        if (existingIdLine !== -1) {
            // Replace existing ID
            const existingLine = document.lineAt(existingIdLine);
            editBuilder.replace(
                new vscode.Range(existingIdLine, 0, existingIdLine, existingLine.text.length),
                `:ID: ${uuid}`
            );
            vscode.window.showInformationMessage(`Updated ID: ${uuid}`);
        } else if (propertiesStart !== -1 && propertiesEnd !== -1) {
            // Add ID to existing properties drawer (before :END:)
            editBuilder.insert(
                new vscode.Position(propertiesEnd, 0),
                `:ID: ${uuid}\n`
            );
            vscode.window.showInformationMessage(`Added ID: ${uuid}`);
        } else {
            // Create new properties drawer after heading
            const headingText = document.lineAt(headingLine).text;
            const indent = headingText.match(/^(\*+)/)?.[1].length === 1 ? '' : '';
            editBuilder.insert(
                new vscode.Position(headingLine + 1, 0),
                `:PROPERTIES:\n:ID: ${uuid}\n:END:\n`
            );
            vscode.window.showInformationMessage(`Added ID: ${uuid}`);
        }
    });
}

/**
 * Setup link context tracking
 */
export function setupLinkContext(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            const document = editor.document;

            // Only check for org/markdown files
            if (!['org', 'markdown'].includes(document.languageId)) {
                vscode.commands.executeCommand('setContext', 'scimax.onLink', false);
                return;
            }

            const position = editor.selection.active;
            const onLink = isOnLink(document, position);
            vscode.commands.executeCommand('setContext', 'scimax.onLink', onLink);
        })
    );
}

/**
 * Check if the current line is a heading
 */
function isOnHeading(document: vscode.TextDocument, position: vscode.Position): boolean {
    const line = document.lineAt(position.line).text;

    if (document.languageId === 'org') {
        // Org heading: starts with one or more asterisks followed by space
        return /^\*+\s/.test(line);
    } else if (document.languageId === 'markdown') {
        // Markdown heading: starts with one or more hashes followed by space
        return /^#+\s/.test(line);
    } else if (document.languageId === 'latex') {
        // LaTeX section commands
        return /^\\(section|subsection|subsubsection|chapter|part)\{/.test(line);
    }

    return false;
}

/**
 * Setup heading context tracking for Tab folding
 */
export function setupHeadingContext(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            const document = editor.document;

            // Only check for supported file types
            if (!['org', 'markdown', 'latex'].includes(document.languageId)) {
                vscode.commands.executeCommand('setContext', 'scimax.onHeading', false);
                vscode.commands.executeCommand('setContext', 'scimax.onResults', false);
                vscode.commands.executeCommand('setContext', 'scimax.onDrawer', false);
                vscode.commands.executeCommand('setContext', 'scimax.onStatisticsCookie', false);
                return;
            }

            const position = editor.selection.active;
            const line = document.lineAt(position.line).text;

            const onHeading = isOnHeading(document, position);
            vscode.commands.executeCommand('setContext', 'scimax.onHeading', onHeading);

            // Check if on results line (#+RESULTS: or :RESULTS: drawer)
            const onResults = /^\s*#\+RESULTS(\[.*\])?:/i.test(line) || /^\s*:RESULTS:\s*$/i.test(line);
            vscode.commands.executeCommand('setContext', 'scimax.onResults', onResults);

            // Check if on drawer line (:NAME: but not :END:)
            const onDrawer = /^\s*:([A-Za-z][A-Za-z0-9_-]*):\s*$/.test(line) && !/^\s*:END:\s*$/i.test(line);
            vscode.commands.executeCommand('setContext', 'scimax.onDrawer', onDrawer);

            // Check if on heading with statistics cookie [n/m] or [n%]
            const onStatisticsCookie = /^(\*+)\s+/.test(line) && /\[(\d+)\/(\d+)\]|\[(\d+)%\]/.test(line);
            vscode.commands.executeCommand('setContext', 'scimax.onStatisticsCookie', onStatisticsCookie);
        })
    );
}

// =============================================================================
// Query Replace
// =============================================================================

/**
 * Decoration type for highlighting the current match during query-replace
 */
const queryReplaceDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    border: '2px solid',
    borderColor: new vscode.ThemeColor('editor.findMatchBorder')
});

/**
 * Interactive query-replace: prompts for search and replacement terms,
 * then steps through each match allowing the user to replace, skip, or replace all.
 */
async function queryReplace(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    // Get search term
    const searchTerm = await vscode.window.showInputBox({
        prompt: 'Query replace',
        placeHolder: 'Search for...'
    });

    if (!searchTerm) {
        return; // User cancelled
    }

    // Get replacement term
    const replacementTerm = await vscode.window.showInputBox({
        prompt: `Query replace "${searchTerm}" with`,
        placeHolder: 'Replace with...'
    });

    if (replacementTerm === undefined) {
        return; // User cancelled (empty string is valid)
    }

    const document = editor.document;
    const text = document.getText();

    // Find all matches
    const matches: vscode.Range[] = [];
    let searchIndex = 0;

    while (true) {
        const foundIndex = text.indexOf(searchTerm, searchIndex);
        if (foundIndex === -1) break;

        const startPos = document.positionAt(foundIndex);
        const endPos = document.positionAt(foundIndex + searchTerm.length);
        matches.push(new vscode.Range(startPos, endPos));
        searchIndex = foundIndex + 1;
    }

    if (matches.length === 0) {
        vscode.window.showInformationMessage(`No matches found for "${searchTerm}"`);
        return;
    }

    let replacedCount = 0;
    let currentIndex = 0;

    // Process matches one at a time
    while (currentIndex < matches.length) {
        // Recalculate the current match position (text may have changed from previous replacements)
        const currentText = editor.document.getText();
        let searchPos = 0;
        let matchRange: vscode.Range | undefined;

        // Skip to the nth remaining match
        let skipCount = currentIndex - replacedCount;
        for (let i = 0; i <= skipCount; i++) {
            const foundIndex = currentText.indexOf(searchTerm, searchPos);
            if (foundIndex === -1) {
                matchRange = undefined;
                break;
            }
            const startPos = editor.document.positionAt(foundIndex);
            const endPos = editor.document.positionAt(foundIndex + searchTerm.length);
            matchRange = new vscode.Range(startPos, endPos);
            searchPos = foundIndex + 1;
        }

        if (!matchRange) {
            break; // No more matches
        }

        // Highlight current match
        editor.setDecorations(queryReplaceDecorationType, [matchRange]);

        // Move cursor to the match and reveal it
        editor.selection = new vscode.Selection(matchRange.start, matchRange.end);
        editor.revealRange(matchRange, vscode.TextEditorRevealType.InCenter);

        // Show options
        const remainingMatches = matches.length - currentIndex;
        const choice = await vscode.window.showQuickPick(
            [
                { label: 'y', description: 'Replace this match' },
                { label: 'n', description: 'Skip this match' },
                { label: '!', description: `Replace all remaining (${remainingMatches})` },
                { label: 'q', description: 'Quit' }
            ],
            {
                placeHolder: `Replace "${searchTerm}" with "${replacementTerm}"? (${currentIndex + 1}/${matches.length})`,
                ignoreFocusOut: true
            }
        );

        if (!choice || choice.label === 'q') {
            // Quit
            editor.setDecorations(queryReplaceDecorationType, []);
            vscode.window.showInformationMessage(
                `Query replace finished: ${replacedCount} replacement${replacedCount !== 1 ? 's' : ''} made`
            );
            return;
        }

        if (choice.label === 'y') {
            // Replace this match
            await editor.edit(editBuilder => {
                editBuilder.replace(matchRange!, replacementTerm);
            });
            replacedCount++;
            currentIndex++;
        } else if (choice.label === 'n') {
            // Skip this match
            currentIndex++;
        } else if (choice.label === '!') {
            // Replace all remaining
            editor.setDecorations(queryReplaceDecorationType, []);

            // Find and replace all remaining matches
            let currentText = editor.document.getText();
            let offset = 0;

            for (let i = currentIndex; i < matches.length; i++) {
                const foundIndex = currentText.indexOf(searchTerm, offset);
                if (foundIndex === -1) break;

                const startPos = editor.document.positionAt(foundIndex);
                const endPos = editor.document.positionAt(foundIndex + searchTerm.length);
                const range = new vscode.Range(startPos, endPos);

                await editor.edit(editBuilder => {
                    editBuilder.replace(range, replacementTerm);
                });

                replacedCount++;
                currentText = editor.document.getText();
                offset = foundIndex + replacementTerm.length;
            }

            vscode.window.showInformationMessage(
                `Query replace finished: ${replacedCount} replacement${replacedCount !== 1 ? 's' : ''} made`
            );
            return;
        }
    }

    // Clear decorations
    editor.setDecorations(queryReplaceDecorationType, []);

    vscode.window.showInformationMessage(
        `Query replace finished: ${replacedCount} replacement${replacedCount !== 1 ? 's' : ''} made`
    );
}

// =============================================================================
// TODO List Functions
// =============================================================================

/**
 * Show TODO items in the current file
 * Displays a QuickPick with all TODO items, allowing navigation to each
 */
async function showTodosInFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const document = editor.document;
    if (document.languageId !== 'org' && !document.fileName.endsWith('.org')) {
        vscode.window.showWarningMessage('Not an org-mode file');
        return;
    }

    const parser = new OrgParser();
    const orgDoc = parser.parse(document.getText());
    const todos = parser.findTodos(orgDoc);

    if (todos.length === 0) {
        vscode.window.showInformationMessage('No TODO items found in this file');
        return;
    }

    // Create QuickPick items
    const items = todos.map(todo => {
        const stateLabel = todo.todoState || '';
        const priorityLabel = todo.priority ? `[#${todo.priority}]` : '';
        const tagsLabel = todo.tags.length > 0 ? `:${todo.tags.join(':')}:` : '';
        const stars = '*'.repeat(todo.level);

        return {
            label: `${stateLabel} ${todo.title}`.trim(),
            description: `${stars} ${priorityLabel} ${tagsLabel}`.trim(),
            detail: `Line ${todo.lineNumber}`,
            lineNumber: todo.lineNumber
        };
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${todos.length} TODO item${todos.length !== 1 ? 's' : ''} in ${path.basename(document.fileName)}`,
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        // Navigate to the selected TODO
        const line = selected.lineNumber - 1; // Convert to 0-indexed
        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    }
}

// =============================================================================
// Command Registration
// =============================================================================

/**
 * Register all scimax-org commands
 */
export function registerScimaxOrgCommands(context: vscode.ExtensionContext): void {
    // Text markup
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.markup.bold', boldRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.italic', italicRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.underline', underlineRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.code', codeRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.verbatim', verbatimRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.strikethrough', strikethroughRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.command', commandRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.subscript', subscriptRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.superscript', superscriptRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.latexMath', latexMathRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.latexDisplayMath', latexDisplayMathRegionOrPoint)
    );

    // Word case commands (Emacs M-c, M-l, M-u)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.capitalizeWord', capitalizeWordAndMove),
        vscode.commands.registerCommand('scimax.lowercaseWord', lowercaseWordAndMove),
        vscode.commands.registerCommand('scimax.uppercaseWord', uppercaseWordAndMove)
    );

    // Non-ASCII character replacement
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.replaceNonAscii', replaceNonAsciiChars)
    );

    // File navigation (Emacs M-< and M->)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.beginningOfBuffer', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const position = new vscode.Position(0, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position));
            }
        }),
        vscode.commands.registerCommand('scimax.endOfBuffer', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const lastLine = editor.document.lineCount - 1;
                const lastChar = editor.document.lineAt(lastLine).text.length;
                const position = new vscode.Position(lastLine, lastChar);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position));
            }
        })
    );

    // Navigation
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.jumpToHeading', jumpToHeading),
        vscode.commands.registerCommand('scimax.org.nextHeading', nextHeading),
        vscode.commands.registerCommand('scimax.org.previousHeading', previousHeading),
        vscode.commands.registerCommand('scimax.org.parentHeading', parentHeading)
    );

    // Heading manipulation
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.promoteHeading', promoteHeading),
        vscode.commands.registerCommand('scimax.org.demoteHeading', demoteHeading),
        vscode.commands.registerCommand('scimax.org.promoteSubtree', promoteSubtree),
        vscode.commands.registerCommand('scimax.org.demoteSubtree', demoteSubtree),
        vscode.commands.registerCommand('scimax.org.moveSubtreeUp', moveSubtreeUp),
        vscode.commands.registerCommand('scimax.org.moveSubtreeDown', moveSubtreeDown),
        vscode.commands.registerCommand('scimax.org.killSubtree', killSubtree),
        vscode.commands.registerCommand('scimax.org.cloneSubtree', cloneSubtree),
        vscode.commands.registerCommand('scimax.org.markSubtree', markSubtree),
        vscode.commands.registerCommand('scimax.org.insertHeading', insertHeading),
        vscode.commands.registerCommand('scimax.org.insertSubheading', insertSubheading),
        vscode.commands.registerCommand('scimax.org.insertInlineTask', insertInlineTask),
        vscode.commands.registerCommand('scimax.org.addIdToHeading', addIdToHeading)
    );

    // TODO/Checkbox
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.cycleTodo', cycleTodoState),
        vscode.commands.registerCommand('scimax.org.toggleCheckbox', toggleCheckbox),
        vscode.commands.registerCommand('scimax.org.toggleCheckboxAt', async (args: { uri: string; line: number }) => {
            const uri = vscode.Uri.parse(args.uri);
            await toggleCheckboxAt(uri, args.line);
        }),
        vscode.commands.registerCommand('scimax.org.insertCheckbox', insertCheckbox),
        vscode.commands.registerCommand('scimax.org.updateStatistics', updateStatisticsAtCursor),
        vscode.commands.registerCommand('scimax.org.showTodos', showTodosInFile)
    );

    // Links
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.storeLink', storeLink),
        vscode.commands.registerCommand('scimax.org.insertLink', insertLink),
        vscode.commands.registerCommand('scimax.org.openLink', openLinkAtPoint),
        vscode.commands.registerCommand('scimax.org.deleteFileLink', deleteFileLinkAtPoint)
    );

    // List commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.renumberList', renumberList)
    );

    // Setup link context tracking for Enter key
    setupLinkContext(context);

    // Setup heading context tracking for Tab folding
    setupHeadingContext(context);

    // Setup list context tracking
    setupListContext(context);

    // Setup dynamic block context tracking
    setupDynamicBlockContext(context);

    // Dynamic block commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.updateDynamicBlock', updateDynamicBlockAtCursor)
    );

    // DWIM Return - falls back to default Enter if not handled
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.dwimReturn', async () => {
            const handled = await dwimReturn();
            if (!handled) {
                // Execute the default Enter action (type newline)
                await vscode.commands.executeCommand('type', { text: '\n' });
            }
        })
    );

    // Simple newline insertion (C-j in Emacs)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.insertNewline', async () => {
            await vscode.commands.executeCommand('type', { text: '\n' });
        })
    );

    // Query replace
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.queryReplace', queryReplace)
    );
}
