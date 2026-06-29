/**
 * Comprehensive mapping of non-ASCII characters to ASCII, LaTeX, and HTML
 * equivalents.
 *
 * This is a dependency-free module (no vscode imports) so it can be shared
 * between the interactive `scimax.replaceNonAscii` command (src/org/scimaxOrg.ts)
 * and the export/escaping layer (src/utils/escapeUtils.ts), which also runs in
 * the CLI without a vscode runtime.
 *
 * The LaTeX values intentionally target math-mode macros (e.g. `$\times$`) so
 * the output compiles under any engine (pdflatex, lualatex, xelatex) rather
 * than relying on a Unicode-capable font being available.
 */

export interface NonAsciiReplacement {
    ascii: string;
    latex: string;
    html: string;
}

export const NON_ASCII_MAP: Record<string, NonAsciiReplacement> = {
    // Latin letters with diacritics - Acute
    'á': { ascii: 'a', latex: "\\'a", html: '&aacute;' },
    'Á': { ascii: 'A', latex: "\\'A", html: '&Aacute;' },
    'é': { ascii: 'e', latex: "\\'e", html: '&eacute;' },
    'É': { ascii: 'E', latex: "\\'E", html: '&Eacute;' },
    'í': { ascii: 'i', latex: "\\'{\\i}", html: '&iacute;' },
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
    'ì': { ascii: 'i', latex: '\\`{\\i}', html: '&igrave;' },
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
    'î': { ascii: 'i', latex: '\\^{\\i}', html: '&icirc;' },
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
    'ï': { ascii: 'i', latex: '\\"{\\i}', html: '&iuml;' },
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
    '‘': { ascii: "'", latex: '`', html: '&lsquo;' },  // left single quote
    '’': { ascii: "'", latex: "'", html: '&rsquo;' },  // right single quote
    '“': { ascii: '"', latex: '``', html: '&ldquo;' }, // left double quote
    '”': { ascii: '"', latex: "''", html: '&rdquo;' }, // right double quote
    '„': { ascii: '"', latex: ',,', html: '&bdquo;' }, // low double quote
    '«': { ascii: '<<', latex: '\\guillemotleft{}', html: '&laquo;' },
    '»': { ascii: '>>', latex: '\\guillemotright{}', html: '&raquo;' },
    '‹': { ascii: '<', latex: '\\guilsinglleft{}', html: '&lsaquo;' },
    '›': { ascii: '>', latex: '\\guilsinglright{}', html: '&rsaquo;' },
    '…': { ascii: '...', latex: '\\ldots{}', html: '&hellip;' },
    '·': { ascii: '.', latex: '\\textperiodcentered{}', html: '&middot;' },
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
    '−': { ascii: '-', latex: '$-$', html: '&minus;' }, // U+2212 minus sign
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
    '↦': { ascii: '|->', latex: '$\\mapsto$', html: '&#8614;' },

    // Blackboard-bold letterlike symbols (common in formal-math / Lean prose)
    'ℝ': { ascii: 'R', latex: '$\\mathbb{R}$', html: '&#8477;' },
    'ℕ': { ascii: 'N', latex: '$\\mathbb{N}$', html: '&#8469;' },
    'ℤ': { ascii: 'Z', latex: '$\\mathbb{Z}$', html: '&#8484;' },
    'ℚ': { ascii: 'Q', latex: '$\\mathbb{Q}$', html: '&#8474;' },
    'ℂ': { ascii: 'C', latex: '$\\mathbb{C}$', html: '&#8450;' },
    'ℙ': { ascii: 'P', latex: '$\\mathbb{P}$', html: '&#8473;' },
    'ℵ': { ascii: 'aleph', latex: '$\\aleph$', html: '&alefsym;' },

    // Extended math operators / relations (valid under amsmath + amssymb, which
    // the LaTeX preamble loads). Keeps math-heavy prose engine-agnostic.
    '≡': { ascii: '==', latex: '$\\equiv$', html: '&equiv;' },
    '≅': { ascii: '~=', latex: '$\\cong$', html: '&cong;' },
    '∼': { ascii: '~', latex: '$\\sim$', html: '&sim;' },
    '≜': { ascii: ':=', latex: '$\\triangleq$', html: '&#8796;' },
    '≔': { ascii: ':=', latex: '$:=$', html: '&#8788;' },
    '≪': { ascii: '<<', latex: '$\\ll$', html: '&#8810;' },
    '≫': { ascii: '>>', latex: '$\\gg$', html: '&#8811;' },
    '∝': { ascii: 'prop', latex: '$\\propto$', html: '&prop;' },
    '∴': { ascii: 'therefore', latex: '$\\therefore$', html: '&#8756;' },
    '∵': { ascii: 'because', latex: '$\\because$', html: '&#8757;' },
    '∎': { ascii: 'QED', latex: '$\\blacksquare$', html: '&#8718;' },
    '∖': { ascii: '\\', latex: '$\\setminus$', html: '&#8726;' },
    '∥': { ascii: '||', latex: '$\\parallel$', html: '&#8741;' },
    '∣': { ascii: '|', latex: '$\\mid$', html: '&#8739;' },
    '∠': { ascii: 'angle', latex: '$\\angle$', html: '&ang;' },
    '⊕': { ascii: '(+)', latex: '$\\oplus$', html: '&oplus;' },
    '⊗': { ascii: '(x)', latex: '$\\otimes$', html: '&otimes;' },
    '⊖': { ascii: '(-)', latex: '$\\ominus$', html: '&#8854;' },
    '⊙': { ascii: '(.)', latex: '$\\odot$', html: '&#8857;' },
    '⊥': { ascii: '_|_', latex: '$\\perp$', html: '&perp;' },
    '⊤': { ascii: 'top', latex: '$\\top$', html: '&#8868;' },
    '⊢': { ascii: '|-', latex: '$\\vdash$', html: '&#8866;' },
    '⊨': { ascii: '|=', latex: '$\\models$', html: '&#8872;' },
    '⊆': { ascii: 'subseteq', latex: '$\\subseteq$', html: '&sube;' },
    '⊇': { ascii: 'supseteq', latex: '$\\supseteq$', html: '&supe;' },
    '⊊': { ascii: 'subsetneq', latex: '$\\subsetneq$', html: '&#8842;' },
    '⊋': { ascii: 'supsetneq', latex: '$\\supsetneq$', html: '&#8843;' },
    '⟨': { ascii: '<', latex: '$\\langle$', html: '&lang;' },
    '⟩': { ascii: '>', latex: '$\\rangle$', html: '&rang;' },
    '⟦': { ascii: '[[', latex: '$[\\![$', html: '&#10214;' },
    '⟧': { ascii: ']]', latex: '$]\\!]$', html: '&#10215;' },
    '⌊': { ascii: 'floor(', latex: '$\\lfloor$', html: '&lfloor;' },
    '⌋': { ascii: ')', latex: '$\\rfloor$', html: '&rfloor;' },
    '⌈': { ascii: 'ceil(', latex: '$\\lceil$', html: '&lceil;' },
    '⌉': { ascii: ')', latex: '$\\rceil$', html: '&rceil;' },
    '↪': { ascii: '->', latex: '$\\hookrightarrow$', html: '&#8618;' },
    '⇝': { ascii: '~>', latex: '$\\rightsquigarrow$', html: '&#8669;' },
    '⨁': { ascii: 'sum(+)', latex: '$\\bigoplus$', html: '&#10753;' },
    '⨂': { ascii: 'prod(x)', latex: '$\\bigotimes$', html: '&#10754;' },

    // Currency
    '€': { ascii: 'EUR', latex: '\\texteuro{}', html: '&euro;' },
    '£': { ascii: 'GBP', latex: '\\pounds{}', html: '&pound;' },
    '¥': { ascii: 'JPY', latex: '\\textyen{}', html: '&yen;' },
    '¢': { ascii: 'c', latex: '\\textcent{}', html: '&cent;' },

    // Fractions
    '½': { ascii: '1/2', latex: '$\\frac{1}{2}$', html: '&frac12;' },
    '¼': { ascii: '1/4', latex: '$\\frac{1}{4}$', html: '&frac14;' },
    '¾': { ascii: '3/4', latex: '$\\frac{3}{4}$', html: '&frac34;' },
    '⅓': { ascii: '1/3', latex: '$\\frac{1}{3}$', html: '&#8531;' },
    '⅔': { ascii: '2/3', latex: '$\\frac{2}{3}$', html: '&#8532;' },
    '⅕': { ascii: '1/5', latex: '$\\frac{1}{5}$', html: '&#8533;' },
    '⅖': { ascii: '2/5', latex: '$\\frac{2}{5}$', html: '&#8534;' },
    '⅗': { ascii: '3/5', latex: '$\\frac{3}{5}$', html: '&#8535;' },
    '⅘': { ascii: '4/5', latex: '$\\frac{4}{5}$', html: '&#8536;' },
    '⅙': { ascii: '1/6', latex: '$\\frac{1}{6}$', html: '&#8537;' },
    '⅚': { ascii: '5/6', latex: '$\\frac{5}{6}$', html: '&#8538;' },
    '⅛': { ascii: '1/8', latex: '$\\frac{1}{8}$', html: '&#8539;' },
    '⅜': { ascii: '3/8', latex: '$\\frac{3}{8}$', html: '&#8540;' },
    '⅝': { ascii: '5/8', latex: '$\\frac{5}{8}$', html: '&#8541;' },
    '⅞': { ascii: '7/8', latex: '$\\frac{7}{8}$', html: '&#8542;' },

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

/**
 * Unicode characters that appear verbatim in code/source blocks (e.g. Lean,
 * Agda, Haskell) and therefore CANNOT be translated to LaTeX macros the way
 * body text is \u2014 verbatim content must be emitted byte-for-byte.
 *
 * For these the LaTeX backend instead emits `\DeclareUnicodeCharacter{<hex>}{...}`
 * declarations in the preamble, so `inputenc`'s utf8 layer knows how to typeset
 * each glyph under pdflatex (the engine used by the auto-generated preamble).
 * The value is the math-mode body, wrapped in `\ensuremath{...}` at emit time so
 * it works both in ordinary text and inside `minted`/verbatim listings.
 *
 * Only symbols that pdflatex+T1 does NOT already handle are listed; plain
 * accented Latin letters are covered by inputenc/fontenc and must not be
 * redeclared here.
 */
export const LATEX_UNICODE_DECLARATIONS: Record<string, string> = {
    // Blackboard-bold letterlike (Lean type universes, number fields)
    '\u211d': '\\mathbb{R}', '\u2115': '\\mathbb{N}', '\u2124': '\\mathbb{Z}',
    '\u211a': '\\mathbb{Q}', '\u2102': '\\mathbb{C}', '\u2119': '\\mathbb{P}',
    // Arrows / maps / composition
    '\u2192': '\\rightarrow', '\u2190': '\\leftarrow', '\u2194': '\\leftrightarrow',
    '\u21d2': '\\Rightarrow', '\u21d0': '\\Leftarrow', '\u21d4': '\\Leftrightarrow',
    '\u21a6': '\\mapsto', '\u2218': '\\circ',
    // Relations
    '\u2260': '\\neq', '\u2264': '\\leq', '\u2265': '\\geq', '\u2248': '\\approx',
    '\u2261': '\\equiv', '\u223c': '\\sim', '\u2245': '\\cong', '\u226a': '\\ll', '\u226b': '\\gg',
    // Big operators / analysis
    '\u2211': '\\sum', '\u220f': '\\prod', '\u222b': '\\int', '\u2202': '\\partial',
    '\u2207': '\\nabla', '\u221a': '\\surd', '\u221e': '\\infty', '\u00b7': '\\cdot', '\u00d7': '\\times',
    // Set theory
    '\u2208': '\\in', '\u2209': '\\notin', '\u220b': '\\ni', '\u2286': '\\subseteq', '\u2282': '\\subset',
    '\u2287': '\\supseteq', '\u2283': '\\supset', '\u222a': '\\cup', '\u2229': '\\cap', '\u2205': '\\emptyset',
    // Logic / quantifiers
    '\u2227': '\\land', '\u2228': '\\lor', '\u00ac': '\\neg', '\u2200': '\\forall', '\u2203': '\\exists',
    // Anonymous-constructor / pairing brackets (Lean \u27e8 \u27e9 \u27e6 \u27e7)
    '\u27e8': '\\langle', '\u27e9': '\\rangle', '\u27e6': '[\\![', '\u27e7': ']\\!]',
    // Proof-theory / algebra operators common in Lean source
    '\u22a2': '\\vdash', '\u22a8': '\\models', '\u2295': '\\oplus', '\u2297': '\\otimes',
    '\u2223': '\\mid', '\u21aa': '\\hookrightarrow',
    // Greek lowercase (frequent as Lean identifiers)
    '\u03b1': '\\alpha', '\u03b2': '\\beta', '\u03b3': '\\gamma', '\u03b4': '\\delta',
    '\u03b5': '\\varepsilon', '\u03b6': '\\zeta', '\u03b7': '\\eta', '\u03b8': '\\theta',
    '\u03b9': '\\iota', '\u03ba': '\\kappa', '\u03bb': '\\lambda', '\u03bc': '\\mu', '\u03bd': '\\nu',
    '\u03be': '\\xi', '\u03c0': '\\pi', '\u03c1': '\\rho', '\u03c3': '\\sigma', '\u03c4': '\\tau',
    '\u03c5': '\\upsilon', '\u03c6': '\\varphi', '\u03c7': '\\chi', '\u03c8': '\\psi', '\u03c9': '\\omega',
    // Greek uppercase (only those distinct from Latin glyphs)
    '\u0393': '\\Gamma', '\u0394': '\\Delta', '\u0398': '\\Theta', '\u039b': '\\Lambda',
    '\u039e': '\\Xi', '\u03a0': '\\Pi', '\u03a3': '\\Sigma', '\u03a6': '\\Phi', '\u03a8': '\\Psi', '\u03a9': '\\Omega',
};
