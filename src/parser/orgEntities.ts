/**
 * Org-mode entity definitions
 * Based on org-entities.el
 * Provides mappings from org entity names to LaTeX, HTML, and UTF-8 representations
 */

export interface EntityDefinition {
    /** LaTeX representation */
    latex: string;
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
    'alpha': { latex: '\\alpha', html: '&alpha;', utf8: 'α' },
    'beta': { latex: '\\beta', html: '&beta;', utf8: 'β' },
    'gamma': { latex: '\\gamma', html: '&gamma;', utf8: 'γ' },
    'delta': { latex: '\\delta', html: '&delta;', utf8: 'δ' },
    'epsilon': { latex: '\\epsilon', html: '&epsilon;', utf8: 'ε' },
    'varepsilon': { latex: '\\varepsilon', html: '&epsilon;', utf8: 'ε' },
    'zeta': { latex: '\\zeta', html: '&zeta;', utf8: 'ζ' },
    'eta': { latex: '\\eta', html: '&eta;', utf8: 'η' },
    'theta': { latex: '\\theta', html: '&theta;', utf8: 'θ' },
    'vartheta': { latex: '\\vartheta', html: '&thetasym;', utf8: 'ϑ' },
    'iota': { latex: '\\iota', html: '&iota;', utf8: 'ι' },
    'kappa': { latex: '\\kappa', html: '&kappa;', utf8: 'κ' },
    'lambda': { latex: '\\lambda', html: '&lambda;', utf8: 'λ' },
    'mu': { latex: '\\mu', html: '&mu;', utf8: 'μ' },
    'nu': { latex: '\\nu', html: '&nu;', utf8: 'ν' },
    'xi': { latex: '\\xi', html: '&xi;', utf8: 'ξ' },
    'omicron': { latex: '\\omicron', html: '&omicron;', utf8: 'ο' },
    'pi': { latex: '\\pi', html: '&pi;', utf8: 'π' },
    'varpi': { latex: '\\varpi', html: '&piv;', utf8: 'ϖ' },
    'rho': { latex: '\\rho', html: '&rho;', utf8: 'ρ' },
    'varrho': { latex: '\\varrho', html: '&rho;', utf8: 'ρ' },
    'sigma': { latex: '\\sigma', html: '&sigma;', utf8: 'σ' },
    'varsigma': { latex: '\\varsigma', html: '&sigmaf;', utf8: 'ς' },
    'tau': { latex: '\\tau', html: '&tau;', utf8: 'τ' },
    'upsilon': { latex: '\\upsilon', html: '&upsilon;', utf8: 'υ' },
    'phi': { latex: '\\phi', html: '&phi;', utf8: 'φ' },
    'varphi': { latex: '\\varphi', html: '&phi;', utf8: 'φ' },
    'chi': { latex: '\\chi', html: '&chi;', utf8: 'χ' },
    'psi': { latex: '\\psi', html: '&psi;', utf8: 'ψ' },
    'omega': { latex: '\\omega', html: '&omega;', utf8: 'ω' },

    // =========================================================================
    // Greek Letters (uppercase)
    // =========================================================================
    'Alpha': { latex: 'A', html: '&Alpha;', utf8: 'Α' },
    'Beta': { latex: 'B', html: '&Beta;', utf8: 'Β' },
    'Gamma': { latex: '\\Gamma', html: '&Gamma;', utf8: 'Γ' },
    'Delta': { latex: '\\Delta', html: '&Delta;', utf8: 'Δ' },
    'Epsilon': { latex: 'E', html: '&Epsilon;', utf8: 'Ε' },
    'Zeta': { latex: 'Z', html: '&Zeta;', utf8: 'Ζ' },
    'Eta': { latex: 'H', html: '&Eta;', utf8: 'Η' },
    'Theta': { latex: '\\Theta', html: '&Theta;', utf8: 'Θ' },
    'Iota': { latex: 'I', html: '&Iota;', utf8: 'Ι' },
    'Kappa': { latex: 'K', html: '&Kappa;', utf8: 'Κ' },
    'Lambda': { latex: '\\Lambda', html: '&Lambda;', utf8: 'Λ' },
    'Mu': { latex: 'M', html: '&Mu;', utf8: 'Μ' },
    'Nu': { latex: 'N', html: '&Nu;', utf8: 'Ν' },
    'Xi': { latex: '\\Xi', html: '&Xi;', utf8: 'Ξ' },
    'Omicron': { latex: 'O', html: '&Omicron;', utf8: 'Ο' },
    'Pi': { latex: '\\Pi', html: '&Pi;', utf8: 'Π' },
    'Rho': { latex: 'P', html: '&Rho;', utf8: 'Ρ' },
    'Sigma': { latex: '\\Sigma', html: '&Sigma;', utf8: 'Σ' },
    'Tau': { latex: 'T', html: '&Tau;', utf8: 'Τ' },
    'Upsilon': { latex: '\\Upsilon', html: '&Upsilon;', utf8: 'Υ' },
    'Phi': { latex: '\\Phi', html: '&Phi;', utf8: 'Φ' },
    'Chi': { latex: 'X', html: '&Chi;', utf8: 'Χ' },
    'Psi': { latex: '\\Psi', html: '&Psi;', utf8: 'Ψ' },
    'Omega': { latex: '\\Omega', html: '&Omega;', utf8: 'Ω' },

    // =========================================================================
    // Hebrew Letters
    // =========================================================================
    'aleph': { latex: '\\aleph', html: '&alefsym;', utf8: 'ℵ' },
    'beth': { latex: '\\beth', html: 'ℶ', utf8: 'ℶ' },
    'gimel': { latex: '\\gimel', html: 'ℷ', utf8: 'ℷ' },
    'daleth': { latex: '\\daleth', html: 'ℸ', utf8: 'ℸ' },

    // =========================================================================
    // Arrows
    // =========================================================================
    'leftarrow': { latex: '\\leftarrow', html: '&larr;', utf8: '←' },
    'uparrow': { latex: '\\uparrow', html: '&uarr;', utf8: '↑' },
    'rightarrow': { latex: '\\rightarrow', html: '&rarr;', utf8: '→' },
    'downarrow': { latex: '\\downarrow', html: '&darr;', utf8: '↓' },
    'leftrightarrow': { latex: '\\leftrightarrow', html: '&harr;', utf8: '↔' },
    'updownarrow': { latex: '\\updownarrow', html: '↕', utf8: '↕' },
    'nwarrow': { latex: '\\nwarrow', html: '↖', utf8: '↖' },
    'nearrow': { latex: '\\nearrow', html: '↗', utf8: '↗' },
    'searrow': { latex: '\\searrow', html: '↘', utf8: '↘' },
    'swarrow': { latex: '\\swarrow', html: '↙', utf8: '↙' },
    'Leftarrow': { latex: '\\Leftarrow', html: '&lArr;', utf8: '⇐' },
    'Uparrow': { latex: '\\Uparrow', html: '&uArr;', utf8: '⇑' },
    'Rightarrow': { latex: '\\Rightarrow', html: '&rArr;', utf8: '⇒' },
    'Downarrow': { latex: '\\Downarrow', html: '&dArr;', utf8: '⇓' },
    'Leftrightarrow': { latex: '\\Leftrightarrow', html: '&hArr;', utf8: '⇔' },
    'Updownarrow': { latex: '\\Updownarrow', html: '⇕', utf8: '⇕' },
    'mapsto': { latex: '\\mapsto', html: '↦', utf8: '↦' },
    'hookleftarrow': { latex: '\\hookleftarrow', html: '↩', utf8: '↩' },
    'hookrightarrow': { latex: '\\hookrightarrow', html: '↪', utf8: '↪' },
    'to': { latex: '\\to', html: '&rarr;', utf8: '→' },
    'gets': { latex: '\\gets', html: '&larr;', utf8: '←' },

    // =========================================================================
    // Mathematical Operators
    // =========================================================================
    'plus': { latex: '+', html: '+', utf8: '+' },
    'minus': { latex: '-', html: '&minus;', utf8: '−' },
    'pm': { latex: '\\pm', html: '&plusmn;', utf8: '±' },
    'mp': { latex: '\\mp', html: '∓', utf8: '∓' },
    'times': { latex: '\\times', html: '&times;', utf8: '×' },
    'div': { latex: '\\div', html: '&divide;', utf8: '÷' },
    'cdot': { latex: '\\cdot', html: '⋅', utf8: '⋅' },
    'ast': { latex: '\\ast', html: '*', utf8: '∗' },
    'star': { latex: '\\star', html: '☆', utf8: '⋆' },
    'circ': { latex: '\\circ', html: '∘', utf8: '∘' },
    'bullet': { latex: '\\bullet', html: '&bull;', utf8: '•' },
    'oplus': { latex: '\\oplus', html: '&oplus;', utf8: '⊕' },
    'ominus': { latex: '\\ominus', html: '⊖', utf8: '⊖' },
    'otimes': { latex: '\\otimes', html: '&otimes;', utf8: '⊗' },
    'circledslash': { latex: '\\oslash', html: '⊘', utf8: '⊘' },
    'odot': { latex: '\\odot', html: '⊙', utf8: '⊙' },

    // =========================================================================
    // Relations
    // =========================================================================
    'leq': { latex: '\\leq', html: '&le;', utf8: '≤' },
    'le': { latex: '\\le', html: '&le;', utf8: '≤' },
    'geq': { latex: '\\geq', html: '&ge;', utf8: '≥' },
    'ge': { latex: '\\ge', html: '&ge;', utf8: '≥' },
    'neq': { latex: '\\neq', html: '&ne;', utf8: '≠' },
    'ne': { latex: '\\ne', html: '&ne;', utf8: '≠' },
    'approx': { latex: '\\approx', html: '&asymp;', utf8: '≈' },
    'sim': { latex: '\\sim', html: '∼', utf8: '∼' },
    'simeq': { latex: '\\simeq', html: '≃', utf8: '≃' },
    'cong': { latex: '\\cong', html: '&cong;', utf8: '≅' },
    'equiv': { latex: '\\equiv', html: '&equiv;', utf8: '≡' },
    'propto': { latex: '\\propto', html: '&prop;', utf8: '∝' },
    'prec': { latex: '\\prec', html: '≺', utf8: '≺' },
    'succ': { latex: '\\succ', html: '≻', utf8: '≻' },
    'preceq': { latex: '\\preceq', html: '⪯', utf8: '⪯' },
    'succeq': { latex: '\\succeq', html: '⪰', utf8: '⪰' },
    'll': { latex: '\\ll', html: '≪', utf8: '≪' },
    'gg': { latex: '\\gg', html: '≫', utf8: '≫' },
    'subset': { latex: '\\subset', html: '&sub;', utf8: '⊂' },
    'supset': { latex: '\\supset', html: '&sup;', utf8: '⊃' },
    'subseteq': { latex: '\\subseteq', html: '&sube;', utf8: '⊆' },
    'supseteq': { latex: '\\supseteq', html: '&supe;', utf8: '⊇' },
    'in': { latex: '\\in', html: '&isin;', utf8: '∈' },
    'notin': { latex: '\\notin', html: '&notin;', utf8: '∉' },
    'ni': { latex: '\\ni', html: '&ni;', utf8: '∋' },
    'perp': { latex: '\\perp', html: '&perp;', utf8: '⊥' },
    'parallel': { latex: '\\parallel', html: '∥', utf8: '∥' },
    'mid': { latex: '\\mid', html: '∣', utf8: '∣' },

    // =========================================================================
    // Set Theory and Logic
    // =========================================================================
    'cap': { latex: '\\cap', html: '&cap;', utf8: '∩' },
    'cup': { latex: '\\cup', html: '&cup;', utf8: '∪' },
    'land': { latex: '\\land', html: '&and;', utf8: '∧' },
    'lor': { latex: '\\lor', html: '&or;', utf8: '∨' },
    'lnot': { latex: '\\lnot', html: '&not;', utf8: '¬' },
    'neg': { latex: '\\neg', html: '&not;', utf8: '¬' },
    'forall': { latex: '\\forall', html: '&forall;', utf8: '∀' },
    'exists': { latex: '\\exists', html: '&exist;', utf8: '∃' },
    'nexists': { latex: '\\nexists', html: '∄', utf8: '∄' },
    'emptyset': { latex: '\\emptyset', html: '&empty;', utf8: '∅' },
    'varnothing': { latex: '\\varnothing', html: '⌀', utf8: '⌀' },

    // =========================================================================
    // Calculus and Analysis
    // =========================================================================
    'nabla': { latex: '\\nabla', html: '&nabla;', utf8: '∇' },
    'partial': { latex: '\\partial', html: '&part;', utf8: '∂' },
    'infty': { latex: '\\infty', html: '&infin;', utf8: '∞' },
    'int': { latex: '\\int', html: '&int;', utf8: '∫' },
    'iint': { latex: '\\iint', html: '∬', utf8: '∬' },
    'iiint': { latex: '\\iiint', html: '∭', utf8: '∭' },
    'oint': { latex: '\\oint', html: '∮', utf8: '∮' },
    'sum': { latex: '\\sum', html: '&sum;', utf8: '∑' },
    'prod': { latex: '\\prod', html: '&prod;', utf8: '∏' },
    'coprod': { latex: '\\coprod', html: '∐', utf8: '∐' },
    'sqrt': { latex: '\\sqrt{}', html: '&radic;', utf8: '√' },

    // =========================================================================
    // Miscellaneous Math Symbols
    // =========================================================================
    'prime': { latex: '\\prime', html: '&prime;', utf8: '′' },
    'dprime': { latex: '\\prime\\prime', html: '″', utf8: '″' },
    'angle': { latex: '\\angle', html: '&ang;', utf8: '∠' },
    'triangle': { latex: '\\triangle', html: '▵', utf8: '△' },
    'diamond': { latex: '\\diamond', html: '⋄', utf8: '⋄' },
    'Box': { latex: '\\Box', html: '□', utf8: '□' },
    'ell': { latex: '\\ell', html: 'ℓ', utf8: 'ℓ' },
    'hbar': { latex: '\\hbar', html: 'ℏ', utf8: 'ℏ' },
    'Re': { latex: '\\Re', html: 'ℜ', utf8: 'ℜ' },
    'Im': { latex: '\\Im', html: 'ℑ', utf8: 'ℑ' },
    'wp': { latex: '\\wp', html: '℘', utf8: '℘' },

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
    'cdots': { latex: '\\cdots{}', html: '⋯', utf8: '⋯' },
    'vdots': { latex: '\\vdots{}', html: '⋮', utf8: '⋮' },
    'ddots': { latex: '\\ddots{}', html: '⋱', utf8: '⋱' },

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
    'checkmark': { latex: '\\checkmark', html: '✓', utf8: '✓' },
    'smiley': { latex: '\\smiley{}', html: '☺', utf8: '☺' },
    'frowny': { latex: '\\frowny{}', html: '☹', utf8: '☹' },
    'clubs': { latex: '\\clubsuit', html: '&clubs;', utf8: '♣' },
    'diamonds': { latex: '\\diamondsuit', html: '&diams;', utf8: '♦' },
    'hearts': { latex: '\\heartsuit', html: '&hearts;', utf8: '♥' },
    'spades': { latex: '\\spadesuit', html: '&spades;', utf8: '♠' },
    'flat': { latex: '\\flat', html: '♭', utf8: '♭' },
    'natural': { latex: '\\natural', html: '♮', utf8: '♮' },
    'sharp': { latex: '\\sharp', html: '♯', utf8: '♯' },
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
