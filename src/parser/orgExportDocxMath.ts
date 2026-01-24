/**
 * LaTeX to Unicode conversion for DOCX export
 * Converts common LaTeX math commands to Unicode equivalents
 */

// Greek letters
const GREEK_LETTERS: Record<string, string> = {
    'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'epsilon': 'ε',
    'zeta': 'ζ', 'eta': 'η', 'theta': 'θ', 'iota': 'ι', 'kappa': 'κ',
    'lambda': 'λ', 'mu': 'μ', 'nu': 'ν', 'xi': 'ξ', 'pi': 'π',
    'rho': 'ρ', 'sigma': 'σ', 'tau': 'τ', 'upsilon': 'υ', 'phi': 'φ',
    'chi': 'χ', 'psi': 'ψ', 'omega': 'ω',
    'Alpha': 'Α', 'Beta': 'Β', 'Gamma': 'Γ', 'Delta': 'Δ', 'Epsilon': 'Ε',
    'Zeta': 'Ζ', 'Eta': 'Η', 'Theta': 'Θ', 'Iota': 'Ι', 'Kappa': 'Κ',
    'Lambda': 'Λ', 'Mu': 'Μ', 'Nu': 'Ν', 'Xi': 'Ξ', 'Pi': 'Π',
    'Rho': 'Ρ', 'Sigma': 'Σ', 'Tau': 'Τ', 'Upsilon': 'Υ', 'Phi': 'Φ',
    'Chi': 'Χ', 'Psi': 'Ψ', 'Omega': 'Ω',
    'varepsilon': 'ε', 'varphi': 'φ', 'varpi': 'ϖ', 'varrho': 'ϱ',
    'varsigma': 'ς', 'vartheta': 'ϑ',
};

// Math operators and symbols
const MATH_SYMBOLS: Record<string, string> = {
    'times': '×', 'div': '÷', 'cdot': '·', 'pm': '±', 'mp': '∓',
    'leq': '≤', 'geq': '≥', 'neq': '≠', 'approx': '≈', 'equiv': '≡',
    'sim': '∼', 'propto': '∝', 'infty': '∞', 'partial': '∂',
    'nabla': '∇', 'sum': '∑', 'prod': '∏', 'int': '∫',
    'oint': '∮', 'sqrt': '√', 'forall': '∀', 'exists': '∃',
    'in': '∈', 'notin': '∉', 'subset': '⊂', 'supset': '⊃',
    'subseteq': '⊆', 'supseteq': '⊇', 'cup': '∪', 'cap': '∩',
    'emptyset': '∅', 'neg': '¬', 'land': '∧', 'lor': '∨',
    'Rightarrow': '⇒', 'Leftarrow': '⇐', 'Leftrightarrow': '⇔',
    'rightarrow': '→', 'leftarrow': '←', 'leftrightarrow': '↔',
    'uparrow': '↑', 'downarrow': '↓', 'mapsto': '↦',
    'ldots': '…', 'cdots': '⋯', 'vdots': '⋮', 'ddots': '⋱',
    'hbar': 'ℏ', 'ell': 'ℓ', 'Re': 'ℜ', 'Im': 'ℑ',
    'aleph': 'ℵ', 'wp': '℘', 'angle': '∠', 'triangle': '△',
    'star': '⋆', 'circ': '∘', 'bullet': '•', 'diamond': '◇',
    'oplus': '⊕', 'otimes': '⊗', 'odot': '⊙',
    'prime': '′', 'degree': '°',
};

// Superscript digits
const SUPERSCRIPTS: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
    'n': 'ⁿ', 'i': 'ⁱ',
};

// Subscript digits
const SUBSCRIPTS: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
    '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
    'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ',
    'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'n': 'ₙ', 'p': 'ₚ',
    'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ', 'v': 'ᵥ',
};

/**
 * Convert a string to superscript Unicode
 */
function toSuperscript(text: string): string {
    return text.split('').map(c => SUPERSCRIPTS[c] || c).join('');
}

/**
 * Convert a string to subscript Unicode
 */
function toSubscript(text: string): string {
    return text.split('').map(c => SUBSCRIPTS[c] || c).join('');
}

/**
 * Convert LaTeX math to Unicode approximation
 */
export function latexToUnicode(latex: string): string {
    let result = latex;

    // Replace Greek letters: \alpha -> α
    for (const [cmd, char] of Object.entries(GREEK_LETTERS)) {
        result = result.replace(new RegExp(`\\\\${cmd}(?![a-zA-Z])`, 'g'), char);
    }

    // Replace math symbols: \times -> ×
    for (const [cmd, char] of Object.entries(MATH_SYMBOLS)) {
        result = result.replace(new RegExp(`\\\\${cmd}(?![a-zA-Z])`, 'g'), char);
    }

    // Handle \frac{a}{b} -> a/b
    result = result.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');

    // Handle simple fractions with single chars: \frac{a}{b} -> a/b
    result = result.replace(/\\frac\{(\w)\}\{(\w)\}/g, '$1/$2');

    // Handle \sqrt{x} -> √(x) or √x for single char
    result = result.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
    result = result.replace(/\\sqrt\{(\w)\}/g, '√$1');

    // Handle superscripts: ^{2} -> ² or ^2 -> ²
    result = result.replace(/\^\{([^{}]+)\}/g, (_, content) => toSuperscript(content));
    result = result.replace(/\^(\w)/g, (_, char) => toSuperscript(char));

    // Handle subscripts: _{2} -> ₂ or _2 -> ₂
    result = result.replace(/_\{([^{}]+)\}/g, (_, content) => toSubscript(content));
    result = result.replace(/_(\w)/g, (_, char) => toSubscript(char));

    // Handle \hat{x} -> x̂
    result = result.replace(/\\hat\{([^{}]+)\}/g, '$1\u0302');

    // Handle \bar{x} -> x̄
    result = result.replace(/\\bar\{([^{}]+)\}/g, '$1\u0304');

    // Handle \vec{x} -> x⃗
    result = result.replace(/\\vec\{([^{}]+)\}/g, '$1\u20D7');

    // Handle \dot{x} -> ẋ
    result = result.replace(/\\dot\{([^{}]+)\}/g, '$1\u0307');

    // Handle \ddot{x} -> ẍ
    result = result.replace(/\\ddot\{([^{}]+)\}/g, '$1\u0308');

    // Handle \tilde{x} -> x̃
    result = result.replace(/\\tilde\{([^{}]+)\}/g, '$1\u0303');

    // Handle \mathbf{x} -> x (bold not available in plain text, just remove command)
    result = result.replace(/\\mathbf\{([^{}]+)\}/g, '$1');
    result = result.replace(/\\mathbb\{([^{}]+)\}/g, '$1');
    result = result.replace(/\\mathrm\{([^{}]+)\}/g, '$1');
    result = result.replace(/\\mathcal\{([^{}]+)\}/g, '$1');

    // Handle \text{...} -> ...
    result = result.replace(/\\text\{([^{}]+)\}/g, '$1');

    // Handle \left and \right (just remove them)
    result = result.replace(/\\left\s*/g, '');
    result = result.replace(/\\right\s*/g, '');

    // Handle \bigl, \bigr, etc.
    result = result.replace(/\\big[lr]?\s*/g, '');
    result = result.replace(/\\Big[lr]?\s*/g, '');

    // Handle spacing commands
    result = result.replace(/\\,/g, ' ');
    result = result.replace(/\\;/g, ' ');
    result = result.replace(/\\:/g, ' ');
    result = result.replace(/\\!/g, '');
    result = result.replace(/\\quad/g, '  ');
    result = result.replace(/\\qquad/g, '    ');

    // Handle \label{...} - remove it
    result = result.replace(/\\label\{[^{}]+\}/g, '');

    // Handle alignment characters in equations
    result = result.replace(/&=/g, ' = ');
    result = result.replace(/&/g, ' ');
    result = result.replace(/\\\\/g, '\n');

    // Clean up multiple spaces
    result = result.replace(/  +/g, ' ');

    // Clean up remaining backslash commands we don't handle
    // Keep them but make them readable
    result = result.replace(/\\([a-zA-Z]+)/g, '$1');

    return result.trim();
}
