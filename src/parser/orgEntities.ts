/**
 * Org-mode entity definitions
 * Based on org-entities.el
 * Provides mappings from org entity names to LaTeX, HTML, and UTF-8 representations
 */

export interface EntityDefinition {
    /** LaTeX representation */
    latex: string;
    /** Whether LaTeX representation requires math mode (like Emacs math-p) */
    mathp?: boolean;
    /** HTML entity or character */
    html: string;
    /** UTF-8 character(s) */
    utf8: string;
}

/**
 * Complete org entity table
 * Organized by category for maintainability
 */
export const ORG_ENTITIES: Record<string, EntityDefinition> = {
    // =========================================================================
    // Greek Letters (lowercase)
    // =========================================================================
    'alpha': { latex: '\\alpha', mathp: true, html: '&alpha;', utf8: 'α' },
    'beta': { latex: '\\beta', mathp: true, html: '&beta;', utf8: 'β' },
    'gamma': { latex: '\\gamma', mathp: true, html: '&gamma;', utf8: 'γ' },
    'delta': { latex: '\\delta', mathp: true, html: '&delta;', utf8: 'δ' },
    'epsilon': { latex: '\\epsilon', mathp: true, html: '&epsilon;', utf8: 'ε' },
    'varepsilon': { latex: '\\varepsilon', mathp: true, html: '&epsilon;', utf8: 'ε' },
    'zeta': { latex: '\\zeta', mathp: true, html: '&zeta;', utf8: 'ζ' },
    'eta': { latex: '\\eta', mathp: true, html: '&eta;', utf8: 'η' },
    'theta': { latex: '\\theta', mathp: true, html: '&theta;', utf8: 'θ' },
    'vartheta': { latex: '\\vartheta', mathp: true, html: '&thetasym;', utf8: 'ϑ' },
    'iota': { latex: '\\iota', mathp: true, html: '&iota;', utf8: 'ι' },
    'kappa': { latex: '\\kappa', mathp: true, html: '&kappa;', utf8: 'κ' },
    'lambda': { latex: '\\lambda', mathp: true, html: '&lambda;', utf8: 'λ' },
    'mu': { latex: '\\mu', mathp: true, html: '&mu;', utf8: 'μ' },
    'nu': { latex: '\\nu', mathp: true, html: '&nu;', utf8: 'ν' },
    'xi': { latex: '\\xi', mathp: true, html: '&xi;', utf8: 'ξ' },
    'omicron': { latex: '\\omicron', mathp: true, html: '&omicron;', utf8: 'ο' },
    'pi': { latex: '\\pi', mathp: true, html: '&pi;', utf8: 'π' },
    'varpi': { latex: '\\varpi', mathp: true, html: '&piv;', utf8: 'ϖ' },
    'rho': { latex: '\\rho', mathp: true, html: '&rho;', utf8: 'ρ' },
    'varrho': { latex: '\\varrho', mathp: true, html: '&rho;', utf8: 'ρ' },
    'sigma': { latex: '\\sigma', mathp: true, html: '&sigma;', utf8: 'σ' },
    'varsigma': { latex: '\\varsigma', mathp: true, html: '&sigmaf;', utf8: 'ς' },
    'tau': { latex: '\\tau', mathp: true, html: '&tau;', utf8: 'τ' },
    'upsilon': { latex: '\\upsilon', mathp: true, html: '&upsilon;', utf8: 'υ' },
    'phi': { latex: '\\phi', mathp: true, html: '&phi;', utf8: 'φ' },
    'varphi': { latex: '\\varphi', mathp: true, html: '&phi;', utf8: 'φ' },
    'chi': { latex: '\\chi', mathp: true, html: '&chi;', utf8: 'χ' },
    'psi': { latex: '\\psi', mathp: true, html: '&psi;', utf8: 'ψ' },
    'omega': { latex: '\\omega', mathp: true, html: '&omega;', utf8: 'ω' },

    // =========================================================================
    // Greek Letters (uppercase)
    // =========================================================================
    'Alpha': { latex: 'A', html: '&Alpha;', utf8: 'Α' },
    'Beta': { latex: 'B', html: '&Beta;', utf8: 'Β' },
    'Gamma': { latex: '\\Gamma', mathp: true, html: '&Gamma;', utf8: 'Γ' },
    'Delta': { latex: '\\Delta', mathp: true, html: '&Delta;', utf8: 'Δ' },
    'Epsilon': { latex: 'E', html: '&Epsilon;', utf8: 'Ε' },
    'Zeta': { latex: 'Z', html: '&Zeta;', utf8: 'Ζ' },
    'Eta': { latex: 'H', html: '&Eta;', utf8: 'Η' },
    'Theta': { latex: '\\Theta', mathp: true, html: '&Theta;', utf8: 'Θ' },
    'Iota': { latex: 'I', html: '&Iota;', utf8: 'Ι' },
    'Kappa': { latex: 'K', html: '&Kappa;', utf8: 'Κ' },
    'Lambda': { latex: '\\Lambda', mathp: true, html: '&Lambda;', utf8: 'Λ' },
    'Mu': { latex: 'M', html: '&Mu;', utf8: 'Μ' },
    'Nu': { latex: 'N', html: '&Nu;', utf8: 'Ν' },
    'Xi': { latex: '\\Xi', mathp: true, html: '&Xi;', utf8: 'Ξ' },
    'Omicron': { latex: 'O', html: '&Omicron;', utf8: 'Ο' },
    'Pi': { latex: '\\Pi', mathp: true, html: '&Pi;', utf8: 'Π' },
    'Rho': { latex: 'P', html: '&Rho;', utf8: 'Ρ' },
    'Sigma': { latex: '\\Sigma', mathp: true, html: '&Sigma;', utf8: 'Σ' },
    'Tau': { latex: 'T', html: '&Tau;', utf8: 'Τ' },
    'Upsilon': { latex: '\\Upsilon', mathp: true, html: '&Upsilon;', utf8: 'Υ' },
    'Phi': { latex: '\\Phi', mathp: true, html: '&Phi;', utf8: 'Φ' },
    'Chi': { latex: 'X', html: '&Chi;', utf8: 'Χ' },
    'Psi': { latex: '\\Psi', mathp: true, html: '&Psi;', utf8: 'Ψ' },
    'Omega': { latex: '\\Omega', mathp: true, html: '&Omega;', utf8: 'Ω' },

    // =========================================================================
    // Hebrew Letters
    // =========================================================================
    'aleph': { latex: '\\aleph', mathp: true, html: '&alefsym;', utf8: 'ℵ' },
    'beth': { latex: '\\beth', mathp: true, html: 'ℶ', utf8: 'ℶ' },
    'gimel': { latex: '\\gimel', mathp: true, html: 'ℷ', utf8: 'ℷ' },
    'daleth': { latex: '\\daleth', mathp: true, html: 'ℸ', utf8: 'ℸ' },

    // =========================================================================
    // Arrows
    // =========================================================================
    'leftarrow': { latex: '\\leftarrow', mathp: true, html: '&larr;', utf8: '←' },
    'uparrow': { latex: '\\uparrow', mathp: true, html: '&uarr;', utf8: '↑' },
    'rightarrow': { latex: '\\rightarrow', mathp: true, html: '&rarr;', utf8: '→' },
    'downarrow': { latex: '\\downarrow', mathp: true, html: '&darr;', utf8: '↓' },
    'leftrightarrow': { latex: '\\leftrightarrow', mathp: true, html: '&harr;', utf8: '↔' },
    'updownarrow': { latex: '\\updownarrow', mathp: true, html: '↕', utf8: '↕' },
    'nwarrow': { latex: '\\nwarrow', mathp: true, html: '↖', utf8: '↖' },
    'nearrow': { latex: '\\nearrow', mathp: true, html: '↗', utf8: '↗' },
    'searrow': { latex: '\\searrow', mathp: true, html: '↘', utf8: '↘' },
    'swarrow': { latex: '\\swarrow', mathp: true, html: '↙', utf8: '↙' },
    'Leftarrow': { latex: '\\Leftarrow', mathp: true, html: '&lArr;', utf8: '⇐' },
    'Uparrow': { latex: '\\Uparrow', mathp: true, html: '&uArr;', utf8: '⇑' },
    'Rightarrow': { latex: '\\Rightarrow', mathp: true, html: '&rArr;', utf8: '⇒' },
    'Downarrow': { latex: '\\Downarrow', mathp: true, html: '&dArr;', utf8: '⇓' },
    'Leftrightarrow': { latex: '\\Leftrightarrow', mathp: true, html: '&hArr;', utf8: '⇔' },
    'Updownarrow': { latex: '\\Updownarrow', mathp: true, html: '⇕', utf8: '⇕' },
    'mapsto': { latex: '\\mapsto', mathp: true, html: '↦', utf8: '↦' },
    'hookleftarrow': { latex: '\\hookleftarrow', mathp: true, html: '↩', utf8: '↩' },
    'hookrightarrow': { latex: '\\hookrightarrow', mathp: true, html: '↪', utf8: '↪' },
    'to': { latex: '\\to', mathp: true, html: '&rarr;', utf8: '→' },
    'gets': { latex: '\\gets', mathp: true, html: '&larr;', utf8: '←' },

    // =========================================================================
    // Mathematical Operators
    // =========================================================================
    'plus': { latex: '+', mathp: true, html: '+', utf8: '+' },
    'minus': { latex: '-', mathp: true, html: '&minus;', utf8: '−' },
    'pm': { latex: '\\pm', mathp: true, html: '&plusmn;', utf8: '±' },
    'mp': { latex: '\\mp', mathp: true, html: '∓', utf8: '∓' },
    'times': { latex: '\\times', mathp: true, html: '&times;', utf8: '×' },
    'div': { latex: '\\div', mathp: true, html: '&divide;', utf8: '÷' },
    'cdot': { latex: '\\cdot', mathp: true, html: '⋅', utf8: '⋅' },
    'ast': { latex: '\\ast', mathp: true, html: '*', utf8: '∗' },
    'star': { latex: '\\star', mathp: true, html: '☆', utf8: '⋆' },
    'circ': { latex: '\\circ', mathp: true, html: '∘', utf8: '∘' },
    'bullet': { latex: '\\bullet', mathp: true, html: '&bull;', utf8: '•' },
    'oplus': { latex: '\\oplus', mathp: true, html: '&oplus;', utf8: '⊕' },
    'ominus': { latex: '\\ominus', mathp: true, html: '⊖', utf8: '⊖' },
    'otimes': { latex: '\\otimes', mathp: true, html: '&otimes;', utf8: '⊗' },
    'circledslash': { latex: '\\oslash', mathp: true, html: '⊘', utf8: '⊘' },
    'odot': { latex: '\\odot', mathp: true, html: '⊙', utf8: '⊙' },

    // =========================================================================
    // Relations
    // =========================================================================
    'leq': { latex: '\\leq', mathp: true, html: '&le;', utf8: '≤' },
    'le': { latex: '\\le', mathp: true, html: '&le;', utf8: '≤' },
    'geq': { latex: '\\geq', mathp: true, html: '&ge;', utf8: '≥' },
    'ge': { latex: '\\ge', mathp: true, html: '&ge;', utf8: '≥' },
    'neq': { latex: '\\neq', mathp: true, html: '&ne;', utf8: '≠' },
    'ne': { latex: '\\ne', mathp: true, html: '&ne;', utf8: '≠' },
    'approx': { latex: '\\approx', mathp: true, html: '&asymp;', utf8: '≈' },
    'sim': { latex: '\\sim', mathp: true, html: '∼', utf8: '∼' },
    'simeq': { latex: '\\simeq', mathp: true, html: '≃', utf8: '≃' },
    'cong': { latex: '\\cong', mathp: true, html: '&cong;', utf8: '≅' },
    'equiv': { latex: '\\equiv', mathp: true, html: '&equiv;', utf8: '≡' },
    'propto': { latex: '\\propto', mathp: true, html: '&prop;', utf8: '∝' },
    'prec': { latex: '\\prec', mathp: true, html: '≺', utf8: '≺' },
    'succ': { latex: '\\succ', mathp: true, html: '≻', utf8: '≻' },
    'preceq': { latex: '\\preceq', mathp: true, html: '⪯', utf8: '⪯' },
    'succeq': { latex: '\\succeq', mathp: true, html: '⪰', utf8: '⪰' },
    'll': { latex: '\\ll', mathp: true, html: '≪', utf8: '≪' },
    'gg': { latex: '\\gg', mathp: true, html: '≫', utf8: '≫' },
    'subset': { latex: '\\subset', mathp: true, html: '&sub;', utf8: '⊂' },
    'supset': { latex: '\\supset', mathp: true, html: '&sup;', utf8: '⊃' },
    'subseteq': { latex: '\\subseteq', mathp: true, html: '&sube;', utf8: '⊆' },
    'supseteq': { latex: '\\supseteq', mathp: true, html: '&supe;', utf8: '⊇' },
    'in': { latex: '\\in', mathp: true, html: '&isin;', utf8: '∈' },
    'notin': { latex: '\\notin', mathp: true, html: '&notin;', utf8: '∉' },
    'ni': { latex: '\\ni', mathp: true, html: '&ni;', utf8: '∋' },
    'perp': { latex: '\\perp', mathp: true, html: '&perp;', utf8: '⊥' },
    'parallel': { latex: '\\parallel', mathp: true, html: '∥', utf8: '∥' },
    'mid': { latex: '\\mid', mathp: true, html: '∣', utf8: '∣' },

    // =========================================================================
    // Set Theory and Logic
    // =========================================================================
    'cap': { latex: '\\cap', mathp: true, html: '&cap;', utf8: '∩' },
    'cup': { latex: '\\cup', mathp: true, html: '&cup;', utf8: '∪' },
    'land': { latex: '\\land', mathp: true, html: '&and;', utf8: '∧' },
    'lor': { latex: '\\lor', mathp: true, html: '&or;', utf8: '∨' },
    'lnot': { latex: '\\lnot', mathp: true, html: '&not;', utf8: '¬' },
    'neg': { latex: '\\neg', mathp: true, html: '&not;', utf8: '¬' },
    'forall': { latex: '\\forall', mathp: true, html: '&forall;', utf8: '∀' },
    'exists': { latex: '\\exists', mathp: true, html: '&exist;', utf8: '∃' },
    'nexists': { latex: '\\nexists', mathp: true, html: '∄', utf8: '∄' },
    'emptyset': { latex: '\\emptyset', mathp: true, html: '&empty;', utf8: '∅' },
    'varnothing': { latex: '\\varnothing', mathp: true, html: '⌀', utf8: '⌀' },

    // =========================================================================
    // Calculus and Analysis
    // =========================================================================
    'nabla': { latex: '\\nabla', mathp: true, html: '&nabla;', utf8: '∇' },
    'partial': { latex: '\\partial', mathp: true, html: '&part;', utf8: '∂' },
    'infty': { latex: '\\infty', mathp: true, html: '&infin;', utf8: '∞' },
    'int': { latex: '\\int', mathp: true, html: '&int;', utf8: '∫' },
    'iint': { latex: '\\iint', mathp: true, html: '∬', utf8: '∬' },
    'iiint': { latex: '\\iiint', mathp: true, html: '∭', utf8: '∭' },
    'oint': { latex: '\\oint', mathp: true, html: '∮', utf8: '∮' },
    'sum': { latex: '\\sum', mathp: true, html: '&sum;', utf8: '∑' },
    'prod': { latex: '\\prod', mathp: true, html: '&prod;', utf8: '∏' },
    'coprod': { latex: '\\coprod', mathp: true, html: '∐', utf8: '∐' },
    'sqrt': { latex: '\\sqrt{}', mathp: true, html: '&radic;', utf8: '√' },

    // =========================================================================
    // Miscellaneous Math Symbols
    // =========================================================================
    'prime': { latex: '\\prime', mathp: true, html: '&prime;', utf8: '′' },
    'dprime': { latex: '\\prime\\prime', mathp: true, html: '″', utf8: '″' },
    'angle': { latex: '\\angle', mathp: true, html: '&ang;', utf8: '∠' },
    'triangle': { latex: '\\triangle', mathp: true, html: '▵', utf8: '△' },
    'diamond': { latex: '\\diamond', mathp: true, html: '⋄', utf8: '⋄' },
    'Box': { latex: '\\Box', mathp: true, html: '□', utf8: '□' },
    'ell': { latex: '\\ell', mathp: true, html: 'ℓ', utf8: 'ℓ' },
    'hbar': { latex: '\\hbar', mathp: true, html: 'ℏ', utf8: 'ℏ' },
    'Re': { latex: '\\Re', mathp: true, html: 'ℜ', utf8: 'ℜ' },
    'Im': { latex: '\\Im', mathp: true, html: 'ℑ', utf8: 'ℑ' },
    'wp': { latex: '\\wp', mathp: true, html: '℘', utf8: '℘' },

    // =========================================================================
    // Typography and Punctuation
    // =========================================================================
    'nbsp': { latex: '~', html: '&nbsp;', utf8: '\u00A0' },
    'ensp': { latex: '\\enspace', html: '&ensp;', utf8: '\u2002' },
    'emsp': { latex: '\\quad', html: '&emsp;', utf8: '\u2003' },
    'thinsp': { latex: '\\,', html: '&thinsp;', utf8: '\u2009' },
    'shy': { latex: '\\-', html: '&shy;', utf8: '\u00AD' },
    'ndash': { latex: '--', html: '&ndash;', utf8: '–' },
    'mdash': { latex: '---', html: '&mdash;', utf8: '—' },
    'lsquo': { latex: '`', html: '&lsquo;', utf8: '\u2018' },
    'rsquo': { latex: "'", html: '&rsquo;', utf8: '\u2019' },
    'sbquo': { latex: ',', html: '&sbquo;', utf8: '\u201A' },
    'ldquo': { latex: '``', html: '&ldquo;', utf8: '\u201C' },
    'rdquo': { latex: "''", html: '&rdquo;', utf8: '\u201D' },
    'bdquo': { latex: ',,', html: '&bdquo;', utf8: '\u201E' },
    'laquo': { latex: '\\guillemotleft', html: '&laquo;', utf8: '«' },
    'raquo': { latex: '\\guillemotright', html: '&raquo;', utf8: '»' },
    'lsaquo': { latex: '\\guilsinglleft', html: '&lsaquo;', utf8: '‹' },
    'rsaquo': { latex: '\\guilsinglright', html: '&rsaquo;', utf8: '›' },
    'hellip': { latex: '\\ldots{}', html: '&hellip;', utf8: '…' },
    'dots': { latex: '\\ldots{}', html: '&hellip;', utf8: '…' },
    'cdots': { latex: '\\cdots{}', mathp: true, html: '⋯', utf8: '⋯' },
    'vdots': { latex: '\\vdots{}', mathp: true, html: '⋮', utf8: '⋮' },
    'ddots': { latex: '\\ddots{}', mathp: true, html: '⋱', utf8: '⋱' },

    // =========================================================================
    // Currency and Commercial
    // =========================================================================
    'cent': { latex: '\\textcent{}', html: '&cent;', utf8: '¢' },
    'pound': { latex: '\\pounds{}', html: '&pound;', utf8: '£' },
    'yen': { latex: '\\yen{}', html: '&yen;', utf8: '¥' },
    'euro': { latex: '\\texteuro{}', html: '&euro;', utf8: '€' },
    'copy': { latex: '\\copyright{}', html: '&copy;', utf8: '©' },
    'reg': { latex: '\\textregistered{}', html: '&reg;', utf8: '®' },
    'trade': { latex: '\\texttrademark{}', html: '&trade;', utf8: '™' },

    // =========================================================================
    // Accented Characters
    // =========================================================================
    'Agrave': { latex: '\\`{A}', html: '&Agrave;', utf8: 'À' },
    'agrave': { latex: '\\`{a}', html: '&agrave;', utf8: 'à' },
    'Aacute': { latex: "\\'{A}", html: '&Aacute;', utf8: 'Á' },
    'aacute': { latex: "\\'{a}", html: '&aacute;', utf8: 'á' },
    'Acirc': { latex: '\\^{A}', html: '&Acirc;', utf8: 'Â' },
    'acirc': { latex: '\\^{a}', html: '&acirc;', utf8: 'â' },
    'Atilde': { latex: '\\~{A}', html: '&Atilde;', utf8: 'Ã' },
    'atilde': { latex: '\\~{a}', html: '&atilde;', utf8: 'ã' },
    'Auml': { latex: '\\"{A}', html: '&Auml;', utf8: 'Ä' },
    'auml': { latex: '\\"{a}', html: '&auml;', utf8: 'ä' },
    'Aring': { latex: '\\AA{}', html: '&Aring;', utf8: 'Å' },
    'aring': { latex: '\\aa{}', html: '&aring;', utf8: 'å' },
    'AElig': { latex: '\\AE{}', html: '&AElig;', utf8: 'Æ' },
    'aelig': { latex: '\\ae{}', html: '&aelig;', utf8: 'æ' },
    'Ccedil': { latex: '\\c{C}', html: '&Ccedil;', utf8: 'Ç' },
    'ccedil': { latex: '\\c{c}', html: '&ccedil;', utf8: 'ç' },
    'Egrave': { latex: '\\`{E}', html: '&Egrave;', utf8: 'È' },
    'egrave': { latex: '\\`{e}', html: '&egrave;', utf8: 'è' },
    'Eacute': { latex: "\\'{E}", html: '&Eacute;', utf8: 'É' },
    'eacute': { latex: "\\'{e}", html: '&eacute;', utf8: 'é' },
    'Ecirc': { latex: '\\^{E}', html: '&Ecirc;', utf8: 'Ê' },
    'ecirc': { latex: '\\^{e}', html: '&ecirc;', utf8: 'ê' },
    'Euml': { latex: '\\"{E}', html: '&Euml;', utf8: 'Ë' },
    'euml': { latex: '\\"{e}', html: '&euml;', utf8: 'ë' },
    'Igrave': { latex: '\\`{I}', html: '&Igrave;', utf8: 'Ì' },
    'igrave': { latex: '\\`{i}', html: '&igrave;', utf8: 'ì' },
    'Iacute': { latex: "\\'{I}", html: '&Iacute;', utf8: 'Í' },
    'iacute': { latex: "\\'{i}", html: '&iacute;', utf8: 'í' },
    'Icirc': { latex: '\\^{I}', html: '&Icirc;', utf8: 'Î' },
    'icirc': { latex: '\\^{i}', html: '&icirc;', utf8: 'î' },
    'Iuml': { latex: '\\"{I}', html: '&Iuml;', utf8: 'Ï' },
    'iuml': { latex: '\\"{i}', html: '&iuml;', utf8: 'ï' },
    'ETH': { latex: '\\DH{}', html: '&ETH;', utf8: 'Ð' },
    'eth': { latex: '\\dh{}', html: '&eth;', utf8: 'ð' },
    'Ntilde': { latex: '\\~{N}', html: '&Ntilde;', utf8: 'Ñ' },
    'ntilde': { latex: '\\~{n}', html: '&ntilde;', utf8: 'ñ' },
    'Ograve': { latex: '\\`{O}', html: '&Ograve;', utf8: 'Ò' },
    'ograve': { latex: '\\`{o}', html: '&ograve;', utf8: 'ò' },
    'Oacute': { latex: "\\'{O}", html: '&Oacute;', utf8: 'Ó' },
    'oacute': { latex: "\\'{o}", html: '&oacute;', utf8: 'ó' },
    'Ocirc': { latex: '\\^{O}', html: '&Ocirc;', utf8: 'Ô' },
    'ocirc': { latex: '\\^{o}', html: '&ocirc;', utf8: 'ô' },
    'Otilde': { latex: '\\~{O}', html: '&Otilde;', utf8: 'Õ' },
    'otilde': { latex: '\\~{o}', html: '&otilde;', utf8: 'õ' },
    'Ouml': { latex: '\\"{O}', html: '&Ouml;', utf8: 'Ö' },
    'ouml': { latex: '\\"{o}', html: '&ouml;', utf8: 'ö' },
    'Oslash': { latex: '\\O{}', html: '&Oslash;', utf8: 'Ø' },
    'oslash': { latex: '\\o{}', html: '&oslash;', utf8: 'ø' },
    'OElig': { latex: '\\OE{}', html: '&OElig;', utf8: 'Œ' },
    'oelig': { latex: '\\oe{}', html: '&oelig;', utf8: 'œ' },
    'Scaron': { latex: '\\v{S}', html: '&Scaron;', utf8: 'Š' },
    'scaron': { latex: '\\v{s}', html: '&scaron;', utf8: 'š' },
    'szlig': { latex: '\\ss{}', html: '&szlig;', utf8: 'ß' },
    'Ugrave': { latex: '\\`{U}', html: '&Ugrave;', utf8: 'Ù' },
    'ugrave': { latex: '\\`{u}', html: '&ugrave;', utf8: 'ù' },
    'Uacute': { latex: "\\'{U}", html: '&Uacute;', utf8: 'Ú' },
    'uacute': { latex: "\\'{u}", html: '&uacute;', utf8: 'ú' },
    'Ucirc': { latex: '\\^{U}', html: '&Ucirc;', utf8: 'Û' },
    'ucirc': { latex: '\\^{u}', html: '&ucirc;', utf8: 'û' },
    'Uuml': { latex: '\\"{U}', html: '&Uuml;', utf8: 'Ü' },
    'uuml': { latex: '\\"{u}', html: '&uuml;', utf8: 'ü' },
    'Yacute': { latex: "\\'{Y}", html: '&Yacute;', utf8: 'Ý' },
    'yacute': { latex: "\\'{y}", html: '&yacute;', utf8: 'ý' },
    'Yuml': { latex: '\\"{Y}', html: '&Yuml;', utf8: 'Ÿ' },
    'yuml': { latex: '\\"{y}', html: '&yuml;', utf8: 'ÿ' },
    'THORN': { latex: '\\TH{}', html: '&THORN;', utf8: 'Þ' },
    'thorn': { latex: '\\th{}', html: '&thorn;', utf8: 'þ' },

    // =========================================================================
    // Miscellaneous
    // =========================================================================
    'dagger': { latex: '\\dag{}', html: '&dagger;', utf8: '†' },
    'Dagger': { latex: '\\ddag{}', html: '&Dagger;', utf8: '‡' },
    'sect': { latex: '\\S{}', html: '&sect;', utf8: '§' },
    'para': { latex: '\\P{}', html: '&para;', utf8: '¶' },
    'deg': { latex: '\\textdegree{}', utf8: '°', html: '&deg;' },
    'checkmark': { latex: '\\checkmark', mathp: true, html: '✓', utf8: '✓' },
    'smiley': { latex: '\\smiley{}', html: '☺', utf8: '☺' },
    'frowny': { latex: '\\frowny{}', html: '☹', utf8: '☹' },
    'clubs': { latex: '\\clubsuit', mathp: true, html: '&clubs;', utf8: '♣' },
    'diamonds': { latex: '\\diamondsuit', mathp: true, html: '&diams;', utf8: '♦' },
    'hearts': { latex: '\\heartsuit', mathp: true, html: '&hearts;', utf8: '♥' },
    'spades': { latex: '\\spadesuit', mathp: true, html: '&spades;', utf8: '♠' },
    'flat': { latex: '\\flat', mathp: true, html: '♭', utf8: '♭' },
    'natural': { latex: '\\natural', mathp: true, html: '♮', utf8: '♮' },
    'sharp': { latex: '\\sharp', mathp: true, html: '♯', utf8: '♯' },
    'iexcl': { latex: '!`', html: '&iexcl;', utf8: '¡' },
    'iquest': { latex: '?`', html: '&iquest;', utf8: '¿' },
    'ordf': { latex: '\\textordfeminine{}', html: '&ordf;', utf8: 'ª' },
    'ordm': { latex: '\\textordmasculine{}', html: '&ordm;', utf8: 'º' },
    'micro': { latex: '\\textmu{}', html: '&micro;', utf8: 'µ' },
    'frac14': { latex: '\\textonequarter{}', html: '&frac14;', utf8: '¼' },
    'frac12': { latex: '\\textonehalf{}', html: '&frac12;', utf8: '½' },
    'frac34': { latex: '\\textthreequarters{}', html: '&frac34;', utf8: '¾' },
    'sup1': { latex: '\\textonesuperior{}', html: '&sup1;', utf8: '¹' },
    'sup2': { latex: '\\texttwosuperior{}', html: '&sup2;', utf8: '²' },
    'sup3': { latex: '\\textthreesuperior{}', html: '&sup3;', utf8: '³' },
};

/**
 * Get entity definition by name
 */
export function getEntity(name: string): EntityDefinition | undefined {
    return ORG_ENTITIES[name];
}

/**
 * Check if a name is a valid entity
 */
export function isValidEntity(name: string): boolean {
    return name in ORG_ENTITIES;
}

/**
 * Get all entity names
 */
export function getAllEntityNames(): string[] {
    return Object.keys(ORG_ENTITIES);
}
