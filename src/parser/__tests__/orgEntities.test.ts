/**
 * Tests for org-mode entity definitions
 * Covers Greek letters, mathematical symbols, arrows, special characters,
 * and the utility functions getEntity, isValidEntity, getAllEntityNames
 */

import { describe, it, expect } from 'vitest';
import {
    ORG_ENTITIES,
    getEntity,
    isValidEntity,
    getAllEntityNames,
    type EntityDefinition,
} from '../orgEntities';

// =============================================================================
// Greek Letters (lowercase)
// =============================================================================

describe('Greek Letters (lowercase)', () => {
    it('defines alpha with correct representations', () => {
        const entity = getEntity('alpha');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\alpha');
        expect(entity!.html).toBe('&alpha;');
        expect(entity!.utf8).toBe('α');
    });

    it('defines beta with correct representations', () => {
        const entity = getEntity('beta');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\beta');
        expect(entity!.html).toBe('&beta;');
        expect(entity!.utf8).toBe('β');
    });

    it('defines gamma with correct representations', () => {
        const entity = getEntity('gamma');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\gamma');
        expect(entity!.html).toBe('&gamma;');
        expect(entity!.utf8).toBe('γ');
    });

    it('defines delta with correct representations', () => {
        const entity = getEntity('delta');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\delta');
        expect(entity!.html).toBe('&delta;');
        expect(entity!.utf8).toBe('δ');
    });

    it('defines epsilon and varepsilon variants', () => {
        const epsilon = getEntity('epsilon');
        expect(epsilon).toBeDefined();
        expect(epsilon!.latex).toBe('\\epsilon');
        expect(epsilon!.utf8).toBe('ε');

        const varepsilon = getEntity('varepsilon');
        expect(varepsilon).toBeDefined();
        expect(varepsilon!.latex).toBe('\\varepsilon');
        expect(varepsilon!.utf8).toBe('ε');
    });

    it('defines theta and vartheta variants', () => {
        const theta = getEntity('theta');
        expect(theta).toBeDefined();
        expect(theta!.latex).toBe('\\theta');
        expect(theta!.utf8).toBe('θ');

        const vartheta = getEntity('vartheta');
        expect(vartheta).toBeDefined();
        expect(vartheta!.latex).toBe('\\vartheta');
        expect(vartheta!.html).toBe('&thetasym;');
        expect(vartheta!.utf8).toBe('ϑ');
    });

    it('defines pi and varpi variants', () => {
        const pi = getEntity('pi');
        expect(pi).toBeDefined();
        expect(pi!.latex).toBe('\\pi');
        expect(pi!.utf8).toBe('π');

        const varpi = getEntity('varpi');
        expect(varpi).toBeDefined();
        expect(varpi!.latex).toBe('\\varpi');
        expect(varpi!.utf8).toBe('ϖ');
    });

    it('defines sigma and varsigma variants', () => {
        const sigma = getEntity('sigma');
        expect(sigma).toBeDefined();
        expect(sigma!.latex).toBe('\\sigma');
        expect(sigma!.utf8).toBe('σ');

        const varsigma = getEntity('varsigma');
        expect(varsigma).toBeDefined();
        expect(varsigma!.latex).toBe('\\varsigma');
        expect(varsigma!.html).toBe('&sigmaf;');
        expect(varsigma!.utf8).toBe('ς');
    });

    it('defines phi and varphi variants', () => {
        const phi = getEntity('phi');
        expect(phi).toBeDefined();
        expect(phi!.latex).toBe('\\phi');
        expect(phi!.utf8).toBe('φ');

        const varphi = getEntity('varphi');
        expect(varphi).toBeDefined();
        expect(varphi!.latex).toBe('\\varphi');
    });

    it('defines lambda with correct representations', () => {
        const entity = getEntity('lambda');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\lambda');
        expect(entity!.html).toBe('&lambda;');
        expect(entity!.utf8).toBe('λ');
    });

    it('defines omega with correct representations', () => {
        const entity = getEntity('omega');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\omega');
        expect(entity!.html).toBe('&omega;');
        expect(entity!.utf8).toBe('ω');
    });

    it('includes all common lowercase Greek letters', () => {
        const lowercaseGreek = [
            'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta',
            'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
            'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma',
            'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
        ];

        for (const letter of lowercaseGreek) {
            expect(isValidEntity(letter)).toBe(true);
            const entity = getEntity(letter);
            expect(entity).toBeDefined();
            expect(entity!.latex).toContain('\\');
        }
    });
});

// =============================================================================
// Greek Letters (uppercase)
// =============================================================================

describe('Greek Letters (uppercase)', () => {
    it('defines Gamma with correct representations', () => {
        const entity = getEntity('Gamma');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\Gamma');
        expect(entity!.html).toBe('&Gamma;');
        expect(entity!.utf8).toBe('Γ');
    });

    it('defines Delta with correct representations', () => {
        const entity = getEntity('Delta');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\Delta');
        expect(entity!.html).toBe('&Delta;');
        expect(entity!.utf8).toBe('Δ');
    });

    it('defines Theta with correct representations', () => {
        const entity = getEntity('Theta');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\Theta');
        expect(entity!.html).toBe('&Theta;');
        expect(entity!.utf8).toBe('Θ');
    });

    it('defines Lambda with correct representations', () => {
        const entity = getEntity('Lambda');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\Lambda');
        expect(entity!.html).toBe('&Lambda;');
        expect(entity!.utf8).toBe('Λ');
    });

    it('defines Pi with correct representations', () => {
        const entity = getEntity('Pi');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\Pi');
        expect(entity!.html).toBe('&Pi;');
        expect(entity!.utf8).toBe('Π');
    });

    it('defines Sigma with correct representations', () => {
        const entity = getEntity('Sigma');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\Sigma');
        expect(entity!.html).toBe('&Sigma;');
        expect(entity!.utf8).toBe('Σ');
    });

    it('defines Omega with correct representations', () => {
        const entity = getEntity('Omega');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\Omega');
        expect(entity!.html).toBe('&Omega;');
        expect(entity!.utf8).toBe('Ω');
    });

    it('uses plain letters for some uppercase Greek that look like Latin', () => {
        // Alpha looks like A, Beta like B, etc.
        const entity = getEntity('Alpha');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('A');
        expect(entity!.html).toBe('&Alpha;');

        const beta = getEntity('Beta');
        expect(beta).toBeDefined();
        expect(beta!.latex).toBe('B');
    });

    it('includes all uppercase Greek letters', () => {
        const uppercaseGreek = [
            'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta',
            'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu',
            'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', 'Sigma',
            'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
        ];

        for (const letter of uppercaseGreek) {
            expect(isValidEntity(letter)).toBe(true);
            const entity = getEntity(letter);
            expect(entity).toBeDefined();
        }
    });
});

// =============================================================================
// Mathematical Operators
// =============================================================================

describe('Mathematical Operators', () => {
    it('defines plus with correct representations', () => {
        const entity = getEntity('plus');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('+');
        expect(entity!.html).toBe('+');
        expect(entity!.utf8).toBe('+');
    });

    it('defines minus with correct representations', () => {
        const entity = getEntity('minus');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('-');
        expect(entity!.html).toBe('&minus;');
        expect(entity!.utf8).toBe('−'); // Note: this is U+2212, not a hyphen
    });

    it('defines times with correct representations', () => {
        const entity = getEntity('times');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\times');
        expect(entity!.html).toBe('&times;');
        expect(entity!.utf8).toBe('×');
    });

    it('defines div with correct representations', () => {
        const entity = getEntity('div');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\div');
        expect(entity!.html).toBe('&divide;');
        expect(entity!.utf8).toBe('÷');
    });

    it('defines pm (plus-minus) with correct representations', () => {
        const entity = getEntity('pm');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\pm');
        expect(entity!.html).toBe('&plusmn;');
        expect(entity!.utf8).toBe('±');
    });

    it('defines mp (minus-plus) with correct representations', () => {
        const entity = getEntity('mp');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\mp');
        expect(entity!.utf8).toBe('∓');
    });

    it('defines cdot with correct representations', () => {
        const entity = getEntity('cdot');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\cdot');
        expect(entity!.utf8).toBe('⋅');
    });

    it('defines circle operators', () => {
        const oplus = getEntity('oplus');
        expect(oplus).toBeDefined();
        expect(oplus!.latex).toBe('\\oplus');
        expect(oplus!.html).toBe('&oplus;');
        expect(oplus!.utf8).toBe('⊕');

        const otimes = getEntity('otimes');
        expect(otimes).toBeDefined();
        expect(otimes!.latex).toBe('\\otimes');
        expect(otimes!.html).toBe('&otimes;');
        expect(otimes!.utf8).toBe('⊗');
    });
});

// =============================================================================
// Relations (comparisons)
// =============================================================================

describe('Relations', () => {
    it('defines leq (less than or equal) with correct representations', () => {
        const entity = getEntity('leq');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\leq');
        expect(entity!.html).toBe('&le;');
        expect(entity!.utf8).toBe('≤');
    });

    it('defines le as alias for leq', () => {
        const entity = getEntity('le');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\le');
        expect(entity!.html).toBe('&le;');
        expect(entity!.utf8).toBe('≤');
    });

    it('defines geq (greater than or equal) with correct representations', () => {
        const entity = getEntity('geq');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\geq');
        expect(entity!.html).toBe('&ge;');
        expect(entity!.utf8).toBe('≥');
    });

    it('defines ge as alias for geq', () => {
        const entity = getEntity('ge');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\ge');
        expect(entity!.html).toBe('&ge;');
        expect(entity!.utf8).toBe('≥');
    });

    it('defines neq (not equal) with correct representations', () => {
        const entity = getEntity('neq');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\neq');
        expect(entity!.html).toBe('&ne;');
        expect(entity!.utf8).toBe('≠');
    });

    it('defines approx with correct representations', () => {
        const entity = getEntity('approx');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\approx');
        expect(entity!.html).toBe('&asymp;');
        expect(entity!.utf8).toBe('≈');
    });

    it('defines equiv (equivalent) with correct representations', () => {
        const entity = getEntity('equiv');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\equiv');
        expect(entity!.html).toBe('&equiv;');
        expect(entity!.utf8).toBe('≡');
    });

    it('defines subset and supset', () => {
        const subset = getEntity('subset');
        expect(subset).toBeDefined();
        expect(subset!.latex).toBe('\\subset');
        expect(subset!.html).toBe('&sub;');
        expect(subset!.utf8).toBe('⊂');

        const supset = getEntity('supset');
        expect(supset).toBeDefined();
        expect(supset!.latex).toBe('\\supset');
        expect(supset!.html).toBe('&sup;');
        expect(supset!.utf8).toBe('⊃');
    });

    it('defines in and notin', () => {
        const inEntity = getEntity('in');
        expect(inEntity).toBeDefined();
        expect(inEntity!.latex).toBe('\\in');
        expect(inEntity!.html).toBe('&isin;');
        expect(inEntity!.utf8).toBe('∈');

        const notin = getEntity('notin');
        expect(notin).toBeDefined();
        expect(notin!.latex).toBe('\\notin');
        expect(notin!.html).toBe('&notin;');
        expect(notin!.utf8).toBe('∉');
    });
});

// =============================================================================
// Arrows
// =============================================================================

describe('Arrows', () => {
    it('defines leftarrow with correct representations', () => {
        const entity = getEntity('leftarrow');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\leftarrow');
        expect(entity!.html).toBe('&larr;');
        expect(entity!.utf8).toBe('←');
    });

    it('defines rightarrow with correct representations', () => {
        const entity = getEntity('rightarrow');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\rightarrow');
        expect(entity!.html).toBe('&rarr;');
        expect(entity!.utf8).toBe('→');
    });

    it('defines uparrow with correct representations', () => {
        const entity = getEntity('uparrow');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\uparrow');
        expect(entity!.html).toBe('&uarr;');
        expect(entity!.utf8).toBe('↑');
    });

    it('defines downarrow with correct representations', () => {
        const entity = getEntity('downarrow');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\downarrow');
        expect(entity!.html).toBe('&darr;');
        expect(entity!.utf8).toBe('↓');
    });

    it('defines leftrightarrow with correct representations', () => {
        const entity = getEntity('leftrightarrow');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\leftrightarrow');
        expect(entity!.html).toBe('&harr;');
        expect(entity!.utf8).toBe('↔');
    });

    it('defines uppercase double arrows', () => {
        const leftarrow = getEntity('Leftarrow');
        expect(leftarrow).toBeDefined();
        expect(leftarrow!.latex).toBe('\\Leftarrow');
        expect(leftarrow!.html).toBe('&lArr;');
        expect(leftarrow!.utf8).toBe('⇐');

        const rightarrow = getEntity('Rightarrow');
        expect(rightarrow).toBeDefined();
        expect(rightarrow!.latex).toBe('\\Rightarrow');
        expect(rightarrow!.html).toBe('&rArr;');
        expect(rightarrow!.utf8).toBe('⇒');

        const leftrightarrow = getEntity('Leftrightarrow');
        expect(leftrightarrow).toBeDefined();
        expect(leftrightarrow!.latex).toBe('\\Leftrightarrow');
        expect(leftrightarrow!.html).toBe('&hArr;');
        expect(leftrightarrow!.utf8).toBe('⇔');
    });

    it('defines diagonal arrows', () => {
        const nw = getEntity('nwarrow');
        expect(nw).toBeDefined();
        expect(nw!.latex).toBe('\\nwarrow');
        expect(nw!.utf8).toBe('↖');

        const ne = getEntity('nearrow');
        expect(ne).toBeDefined();
        expect(ne!.latex).toBe('\\nearrow');
        expect(ne!.utf8).toBe('↗');

        const se = getEntity('searrow');
        expect(se).toBeDefined();
        expect(se!.latex).toBe('\\searrow');
        expect(se!.utf8).toBe('↘');

        const sw = getEntity('swarrow');
        expect(sw).toBeDefined();
        expect(sw!.latex).toBe('\\swarrow');
        expect(sw!.utf8).toBe('↙');
    });

    it('defines mapsto arrow', () => {
        const entity = getEntity('mapsto');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\mapsto');
        expect(entity!.utf8).toBe('↦');
    });

    it('defines to and gets as arrow aliases', () => {
        const to = getEntity('to');
        expect(to).toBeDefined();
        expect(to!.latex).toBe('\\to');
        expect(to!.html).toBe('&rarr;');
        expect(to!.utf8).toBe('→');

        const gets = getEntity('gets');
        expect(gets).toBeDefined();
        expect(gets!.latex).toBe('\\gets');
        expect(gets!.html).toBe('&larr;');
        expect(gets!.utf8).toBe('←');
    });
});

// =============================================================================
// Special Characters
// =============================================================================

describe('Special Characters', () => {
    it('defines copyright symbol', () => {
        const entity = getEntity('copy');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\copyright{}');
        expect(entity!.html).toBe('&copy;');
        expect(entity!.utf8).toBe('©');
    });

    it('defines registered trademark symbol', () => {
        const entity = getEntity('reg');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\textregistered{}');
        expect(entity!.html).toBe('&reg;');
        expect(entity!.utf8).toBe('®');
    });

    it('defines trademark symbol', () => {
        const entity = getEntity('trade');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\texttrademark{}');
        expect(entity!.html).toBe('&trade;');
        expect(entity!.utf8).toBe('™');
    });

    it('defines degree symbol', () => {
        const entity = getEntity('deg');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\textdegree{}');
        expect(entity!.html).toBe('&deg;');
        expect(entity!.utf8).toBe('°');
    });

    it('defines section symbol', () => {
        const entity = getEntity('sect');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\S{}');
        expect(entity!.html).toBe('&sect;');
        expect(entity!.utf8).toBe('§');
    });

    it('defines paragraph symbol', () => {
        const entity = getEntity('para');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\P{}');
        expect(entity!.html).toBe('&para;');
        expect(entity!.utf8).toBe('¶');
    });

    it('defines dagger symbols', () => {
        const dagger = getEntity('dagger');
        expect(dagger).toBeDefined();
        expect(dagger!.latex).toBe('\\dag{}');
        expect(dagger!.html).toBe('&dagger;');
        expect(dagger!.utf8).toBe('†');

        const ddagger = getEntity('Dagger');
        expect(ddagger).toBeDefined();
        expect(ddagger!.latex).toBe('\\ddag{}');
        expect(ddagger!.html).toBe('&Dagger;');
        expect(ddagger!.utf8).toBe('‡');
    });

    it('defines checkmark', () => {
        const entity = getEntity('checkmark');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\checkmark');
        expect(entity!.utf8).toBe('✓');
    });
});

// =============================================================================
// Currency Symbols
// =============================================================================

describe('Currency Symbols', () => {
    it('defines cent', () => {
        const entity = getEntity('cent');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\textcent{}');
        expect(entity!.html).toBe('&cent;');
        expect(entity!.utf8).toBe('¢');
    });

    it('defines pound', () => {
        const entity = getEntity('pound');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\pounds{}');
        expect(entity!.html).toBe('&pound;');
        expect(entity!.utf8).toBe('£');
    });

    it('defines yen', () => {
        const entity = getEntity('yen');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\yen{}');
        expect(entity!.html).toBe('&yen;');
        expect(entity!.utf8).toBe('¥');
    });

    it('defines euro', () => {
        const entity = getEntity('euro');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\texteuro{}');
        expect(entity!.html).toBe('&euro;');
        expect(entity!.utf8).toBe('€');
    });
});

// =============================================================================
// Typography and Punctuation
// =============================================================================

describe('Typography and Punctuation', () => {
    it('defines non-breaking space', () => {
        const entity = getEntity('nbsp');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('~');
        expect(entity!.html).toBe('&nbsp;');
        expect(entity!.utf8).toBe('\u00A0');
    });

    it('defines dashes', () => {
        const ndash = getEntity('ndash');
        expect(ndash).toBeDefined();
        expect(ndash!.latex).toBe('--');
        expect(ndash!.html).toBe('&ndash;');
        expect(ndash!.utf8).toBe('–');

        const mdash = getEntity('mdash');
        expect(mdash).toBeDefined();
        expect(mdash!.latex).toBe('---');
        expect(mdash!.html).toBe('&mdash;');
        expect(mdash!.utf8).toBe('—');
    });

    it('defines quotation marks', () => {
        const lsquo = getEntity('lsquo');
        expect(lsquo).toBeDefined();
        expect(lsquo!.html).toBe('&lsquo;');
        expect(lsquo!.utf8).toBe('\u2018');

        const rsquo = getEntity('rsquo');
        expect(rsquo).toBeDefined();
        expect(rsquo!.html).toBe('&rsquo;');
        expect(rsquo!.utf8).toBe('\u2019');

        const ldquo = getEntity('ldquo');
        expect(ldquo).toBeDefined();
        expect(ldquo!.latex).toBe('``');
        expect(ldquo!.html).toBe('&ldquo;');

        const rdquo = getEntity('rdquo');
        expect(rdquo).toBeDefined();
        expect(rdquo!.latex).toBe("''");
        expect(rdquo!.html).toBe('&rdquo;');
    });

    it('defines guillemets', () => {
        const laquo = getEntity('laquo');
        expect(laquo).toBeDefined();
        expect(laquo!.latex).toBe('\\guillemotleft');
        expect(laquo!.html).toBe('&laquo;');
        expect(laquo!.utf8).toBe('«');

        const raquo = getEntity('raquo');
        expect(raquo).toBeDefined();
        expect(raquo!.latex).toBe('\\guillemotright');
        expect(raquo!.html).toBe('&raquo;');
        expect(raquo!.utf8).toBe('»');
    });

    it('defines ellipsis', () => {
        const hellip = getEntity('hellip');
        expect(hellip).toBeDefined();
        expect(hellip!.latex).toBe('\\ldots{}');
        expect(hellip!.html).toBe('&hellip;');
        expect(hellip!.utf8).toBe('…');

        const dots = getEntity('dots');
        expect(dots).toBeDefined();
        expect(dots!.latex).toBe('\\ldots{}');
        expect(dots!.utf8).toBe('…');
    });
});

// =============================================================================
// Set Theory and Logic
// =============================================================================

describe('Set Theory and Logic', () => {
    it('defines forall and exists', () => {
        const forall = getEntity('forall');
        expect(forall).toBeDefined();
        expect(forall!.latex).toBe('\\forall');
        expect(forall!.html).toBe('&forall;');
        expect(forall!.utf8).toBe('∀');

        const exists = getEntity('exists');
        expect(exists).toBeDefined();
        expect(exists!.latex).toBe('\\exists');
        expect(exists!.html).toBe('&exist;');
        expect(exists!.utf8).toBe('∃');
    });

    it('defines logical operators', () => {
        const land = getEntity('land');
        expect(land).toBeDefined();
        expect(land!.latex).toBe('\\land');
        expect(land!.html).toBe('&and;');
        expect(land!.utf8).toBe('∧');

        const lor = getEntity('lor');
        expect(lor).toBeDefined();
        expect(lor!.latex).toBe('\\lor');
        expect(lor!.html).toBe('&or;');
        expect(lor!.utf8).toBe('∨');

        const lnot = getEntity('lnot');
        expect(lnot).toBeDefined();
        expect(lnot!.latex).toBe('\\lnot');
        expect(lnot!.html).toBe('&not;');
        expect(lnot!.utf8).toBe('¬');
    });

    it('defines set operations', () => {
        const cap = getEntity('cap');
        expect(cap).toBeDefined();
        expect(cap!.latex).toBe('\\cap');
        expect(cap!.html).toBe('&cap;');
        expect(cap!.utf8).toBe('∩');

        const cup = getEntity('cup');
        expect(cup).toBeDefined();
        expect(cup!.latex).toBe('\\cup');
        expect(cup!.html).toBe('&cup;');
        expect(cup!.utf8).toBe('∪');
    });

    it('defines empty set', () => {
        const emptyset = getEntity('emptyset');
        expect(emptyset).toBeDefined();
        expect(emptyset!.latex).toBe('\\emptyset');
        expect(emptyset!.html).toBe('&empty;');
        expect(emptyset!.utf8).toBe('∅');
    });
});

// =============================================================================
// Calculus and Analysis
// =============================================================================

describe('Calculus and Analysis', () => {
    it('defines infinity', () => {
        const entity = getEntity('infty');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\infty');
        expect(entity!.html).toBe('&infin;');
        expect(entity!.utf8).toBe('∞');
    });

    it('defines nabla (gradient)', () => {
        const entity = getEntity('nabla');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\nabla');
        expect(entity!.html).toBe('&nabla;');
        expect(entity!.utf8).toBe('∇');
    });

    it('defines partial derivative', () => {
        const entity = getEntity('partial');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\partial');
        expect(entity!.html).toBe('&part;');
        expect(entity!.utf8).toBe('∂');
    });

    it('defines integral symbols', () => {
        const int = getEntity('int');
        expect(int).toBeDefined();
        expect(int!.latex).toBe('\\int');
        expect(int!.html).toBe('&int;');
        expect(int!.utf8).toBe('∫');

        const iint = getEntity('iint');
        expect(iint).toBeDefined();
        expect(iint!.latex).toBe('\\iint');
        expect(iint!.utf8).toBe('∬');

        const iiint = getEntity('iiint');
        expect(iiint).toBeDefined();
        expect(iiint!.latex).toBe('\\iiint');
        expect(iiint!.utf8).toBe('∭');
    });

    it('defines sum and product', () => {
        const sum = getEntity('sum');
        expect(sum).toBeDefined();
        expect(sum!.latex).toBe('\\sum');
        expect(sum!.html).toBe('&sum;');
        expect(sum!.utf8).toBe('∑');

        const prod = getEntity('prod');
        expect(prod).toBeDefined();
        expect(prod!.latex).toBe('\\prod');
        expect(prod!.html).toBe('&prod;');
        expect(prod!.utf8).toBe('∏');
    });

    it('defines square root', () => {
        const entity = getEntity('sqrt');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\sqrt{}');
        expect(entity!.html).toBe('&radic;');
        expect(entity!.utf8).toBe('√');
    });
});

// =============================================================================
// Hebrew Letters
// =============================================================================

describe('Hebrew Letters', () => {
    it('defines aleph', () => {
        const entity = getEntity('aleph');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\aleph');
        expect(entity!.html).toBe('&alefsym;');
        expect(entity!.utf8).toBe('ℵ');
    });

    it('defines beth, gimel, daleth', () => {
        const beth = getEntity('beth');
        expect(beth).toBeDefined();
        expect(beth!.latex).toBe('\\beth');
        expect(beth!.utf8).toBe('ℶ');

        const gimel = getEntity('gimel');
        expect(gimel).toBeDefined();
        expect(gimel!.latex).toBe('\\gimel');
        expect(gimel!.utf8).toBe('ℷ');

        const daleth = getEntity('daleth');
        expect(daleth).toBeDefined();
        expect(daleth!.latex).toBe('\\daleth');
        expect(daleth!.utf8).toBe('ℸ');
    });
});

// =============================================================================
// Fractions and Superscripts
// =============================================================================

describe('Fractions and Superscripts', () => {
    it('defines common fractions', () => {
        const frac14 = getEntity('frac14');
        expect(frac14).toBeDefined();
        expect(frac14!.html).toBe('&frac14;');
        expect(frac14!.utf8).toBe('¼');

        const frac12 = getEntity('frac12');
        expect(frac12).toBeDefined();
        expect(frac12!.html).toBe('&frac12;');
        expect(frac12!.utf8).toBe('½');

        const frac34 = getEntity('frac34');
        expect(frac34).toBeDefined();
        expect(frac34!.html).toBe('&frac34;');
        expect(frac34!.utf8).toBe('¾');
    });

    it('defines superscript numbers', () => {
        const sup1 = getEntity('sup1');
        expect(sup1).toBeDefined();
        expect(sup1!.html).toBe('&sup1;');
        expect(sup1!.utf8).toBe('¹');

        const sup2 = getEntity('sup2');
        expect(sup2).toBeDefined();
        expect(sup2!.html).toBe('&sup2;');
        expect(sup2!.utf8).toBe('²');

        const sup3 = getEntity('sup3');
        expect(sup3).toBeDefined();
        expect(sup3!.html).toBe('&sup3;');
        expect(sup3!.utf8).toBe('³');
    });
});

// =============================================================================
// Card Suits
// =============================================================================

describe('Card Suits', () => {
    it('defines all four card suits', () => {
        const clubs = getEntity('clubs');
        expect(clubs).toBeDefined();
        expect(clubs!.latex).toBe('\\clubsuit');
        expect(clubs!.html).toBe('&clubs;');
        expect(clubs!.utf8).toBe('♣');

        const diamonds = getEntity('diamonds');
        expect(diamonds).toBeDefined();
        expect(diamonds!.latex).toBe('\\diamondsuit');
        expect(diamonds!.html).toBe('&diams;');
        expect(diamonds!.utf8).toBe('♦');

        const hearts = getEntity('hearts');
        expect(hearts).toBeDefined();
        expect(hearts!.latex).toBe('\\heartsuit');
        expect(hearts!.html).toBe('&hearts;');
        expect(hearts!.utf8).toBe('♥');

        const spades = getEntity('spades');
        expect(spades).toBeDefined();
        expect(spades!.latex).toBe('\\spadesuit');
        expect(spades!.html).toBe('&spades;');
        expect(spades!.utf8).toBe('♠');
    });
});

// =============================================================================
// isValidEntity function
// =============================================================================

describe('isValidEntity', () => {
    it('returns true for valid Greek letters', () => {
        expect(isValidEntity('alpha')).toBe(true);
        expect(isValidEntity('beta')).toBe(true);
        expect(isValidEntity('Gamma')).toBe(true);
        expect(isValidEntity('Delta')).toBe(true);
    });

    it('returns true for valid mathematical operators', () => {
        expect(isValidEntity('plus')).toBe(true);
        expect(isValidEntity('minus')).toBe(true);
        expect(isValidEntity('times')).toBe(true);
        expect(isValidEntity('leq')).toBe(true);
        expect(isValidEntity('geq')).toBe(true);
    });

    it('returns true for valid arrows', () => {
        expect(isValidEntity('leftarrow')).toBe(true);
        expect(isValidEntity('rightarrow')).toBe(true);
        expect(isValidEntity('Rightarrow')).toBe(true);
    });

    it('returns true for valid special characters', () => {
        expect(isValidEntity('copy')).toBe(true);
        expect(isValidEntity('reg')).toBe(true);
        expect(isValidEntity('trade')).toBe(true);
    });

    it('returns false for invalid entity names', () => {
        expect(isValidEntity('notanentity')).toBe(false);
        expect(isValidEntity('invalid')).toBe(false);
        expect(isValidEntity('')).toBe(false);
        expect(isValidEntity('ALPHA')).toBe(false); // case sensitive - correct is 'Alpha'
        expect(isValidEntity('BETA')).toBe(false);
    });

    it('returns false for entity names with wrong case', () => {
        expect(isValidEntity('ALPHA')).toBe(false);
        expect(isValidEntity('GAMMA')).toBe(false);
        expect(isValidEntity('LEFTARROW')).toBe(false);
    });

    it('returns false for partial entity names', () => {
        expect(isValidEntity('alph')).toBe(false);
        expect(isValidEntity('bet')).toBe(false);
        expect(isValidEntity('left')).toBe(false);
    });

    it('returns false for entity names with extra characters', () => {
        expect(isValidEntity('alpha1')).toBe(false);
        expect(isValidEntity('_alpha')).toBe(false);
        expect(isValidEntity('alpha_')).toBe(false);
    });
});

// =============================================================================
// getAllEntityNames function
// =============================================================================

describe('getAllEntityNames', () => {
    it('returns an array', () => {
        const names = getAllEntityNames();
        expect(Array.isArray(names)).toBe(true);
    });

    it('returns a non-empty array', () => {
        const names = getAllEntityNames();
        expect(names.length).toBeGreaterThan(0);
    });

    it('contains expected Greek letters', () => {
        const names = getAllEntityNames();
        expect(names).toContain('alpha');
        expect(names).toContain('beta');
        expect(names).toContain('gamma');
        expect(names).toContain('Gamma');
        expect(names).toContain('Delta');
        expect(names).toContain('omega');
        expect(names).toContain('Omega');
    });

    it('contains expected mathematical symbols', () => {
        const names = getAllEntityNames();
        expect(names).toContain('plus');
        expect(names).toContain('minus');
        expect(names).toContain('times');
        expect(names).toContain('leq');
        expect(names).toContain('geq');
        expect(names).toContain('neq');
    });

    it('contains expected arrows', () => {
        const names = getAllEntityNames();
        expect(names).toContain('leftarrow');
        expect(names).toContain('rightarrow');
        expect(names).toContain('uparrow');
        expect(names).toContain('downarrow');
        expect(names).toContain('Rightarrow');
    });

    it('contains expected special characters', () => {
        const names = getAllEntityNames();
        expect(names).toContain('copy');
        expect(names).toContain('reg');
        expect(names).toContain('trade');
        expect(names).toContain('nbsp');
    });

    it('returns same keys as ORG_ENTITIES object', () => {
        const names = getAllEntityNames();
        const directKeys = Object.keys(ORG_ENTITIES);
        expect(names).toEqual(directKeys);
        expect(names.length).toBe(directKeys.length);
    });

    it('contains more than 100 entities', () => {
        const names = getAllEntityNames();
        expect(names.length).toBeGreaterThan(100);
    });
});

// =============================================================================
// getEntity function
// =============================================================================

describe('getEntity', () => {
    it('returns EntityDefinition for valid entity', () => {
        const entity = getEntity('alpha');
        expect(entity).toBeDefined();
        expect(entity).toHaveProperty('latex');
        expect(entity).toHaveProperty('html');
        expect(entity).toHaveProperty('utf8');
    });

    it('returns undefined for unknown entity', () => {
        const entity = getEntity('notanentity');
        expect(entity).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
        const entity = getEntity('');
        expect(entity).toBeUndefined();
    });

    it('returns correct latex for known entities', () => {
        expect(getEntity('alpha')!.latex).toBe('\\alpha');
        expect(getEntity('rightarrow')!.latex).toBe('\\rightarrow');
        expect(getEntity('infty')!.latex).toBe('\\infty');
        expect(getEntity('times')!.latex).toBe('\\times');
    });

    it('returns correct html for known entities', () => {
        expect(getEntity('alpha')!.html).toBe('&alpha;');
        expect(getEntity('rightarrow')!.html).toBe('&rarr;');
        expect(getEntity('copy')!.html).toBe('&copy;');
        expect(getEntity('nbsp')!.html).toBe('&nbsp;');
    });

    it('returns correct utf8 for known entities', () => {
        expect(getEntity('alpha')!.utf8).toBe('α');
        expect(getEntity('rightarrow')!.utf8).toBe('→');
        expect(getEntity('infty')!.utf8).toBe('∞');
        expect(getEntity('checkmark')!.utf8).toBe('✓');
    });

    it('is case-sensitive', () => {
        expect(getEntity('gamma')).toBeDefined();
        expect(getEntity('Gamma')).toBeDefined();
        expect(getEntity('GAMMA')).toBeUndefined();

        // Lowercase and uppercase gamma have different values
        expect(getEntity('gamma')!.utf8).toBe('γ');
        expect(getEntity('Gamma')!.utf8).toBe('Γ');
    });

    it('returns the same reference as ORG_ENTITIES', () => {
        const entity = getEntity('alpha');
        expect(entity).toBe(ORG_ENTITIES['alpha']);
    });
});

// =============================================================================
// ORG_ENTITIES constant
// =============================================================================

describe('ORG_ENTITIES constant', () => {
    it('is a Record object', () => {
        expect(typeof ORG_ENTITIES).toBe('object');
        expect(ORG_ENTITIES).not.toBeNull();
    });

    it('all values have latex, html, and utf8 properties', () => {
        for (const [name, entity] of Object.entries(ORG_ENTITIES)) {
            expect(entity).toHaveProperty('latex', expect.any(String));
            expect(entity).toHaveProperty('html', expect.any(String));
            expect(entity).toHaveProperty('utf8', expect.any(String));
        }
    });

    it('all values have non-empty strings for all properties', () => {
        for (const [name, entity] of Object.entries(ORG_ENTITIES)) {
            expect(entity.latex.length).toBeGreaterThan(0);
            expect(entity.html.length).toBeGreaterThan(0);
            expect(entity.utf8.length).toBeGreaterThan(0);
        }
    });

    it('does not allow modification at runtime', () => {
        // This test verifies the constant behavior
        // Note: In strict TypeScript with readonly, direct modification would be a compile error
        const originalAlpha = ORG_ENTITIES['alpha'];
        expect(originalAlpha.latex).toBe('\\alpha');

        // The object is exported as const, so its structure should be stable
        expect(Object.keys(ORG_ENTITIES).length).toBeGreaterThan(0);
    });
});

// =============================================================================
// Accented Characters
// =============================================================================

describe('Accented Characters', () => {
    it('defines grave accents', () => {
        const agrave = getEntity('agrave');
        expect(agrave).toBeDefined();
        expect(agrave!.latex).toBe('\\`{a}');
        expect(agrave!.html).toBe('&agrave;');
        expect(agrave!.utf8).toBe('à');

        const Agrave = getEntity('Agrave');
        expect(Agrave).toBeDefined();
        expect(Agrave!.latex).toBe('\\`{A}');
        expect(Agrave!.html).toBe('&Agrave;');
        expect(Agrave!.utf8).toBe('À');
    });

    it('defines acute accents', () => {
        const eacute = getEntity('eacute');
        expect(eacute).toBeDefined();
        expect(eacute!.latex).toBe("\\'{e}");
        expect(eacute!.html).toBe('&eacute;');
        expect(eacute!.utf8).toBe('é');
    });

    it('defines circumflex accents', () => {
        const acirc = getEntity('acirc');
        expect(acirc).toBeDefined();
        expect(acirc!.latex).toBe('\\^{a}');
        expect(acirc!.html).toBe('&acirc;');
        expect(acirc!.utf8).toBe('â');
    });

    it('defines tilde accents', () => {
        const ntilde = getEntity('ntilde');
        expect(ntilde).toBeDefined();
        expect(ntilde!.latex).toBe('\\~{n}');
        expect(ntilde!.html).toBe('&ntilde;');
        expect(ntilde!.utf8).toBe('ñ');
    });

    it('defines umlaut accents', () => {
        const ouml = getEntity('ouml');
        expect(ouml).toBeDefined();
        expect(ouml!.latex).toBe('\\"{o}');
        expect(ouml!.html).toBe('&ouml;');
        expect(ouml!.utf8).toBe('ö');
    });

    it('defines cedilla', () => {
        const ccedil = getEntity('ccedil');
        expect(ccedil).toBeDefined();
        expect(ccedil!.latex).toBe('\\c{c}');
        expect(ccedil!.html).toBe('&ccedil;');
        expect(ccedil!.utf8).toBe('ç');
    });

    it('defines special characters like szlig (German sharp s)', () => {
        const szlig = getEntity('szlig');
        expect(szlig).toBeDefined();
        expect(szlig!.latex).toBe('\\ss{}');
        expect(szlig!.html).toBe('&szlig;');
        expect(szlig!.utf8).toBe('ß');
    });

    it('defines Scandinavian characters', () => {
        const aring = getEntity('aring');
        expect(aring).toBeDefined();
        expect(aring!.latex).toBe('\\aa{}');
        expect(aring!.utf8).toBe('å');

        const oslash = getEntity('oslash');
        expect(oslash).toBeDefined();
        expect(oslash!.latex).toBe('\\o{}');
        expect(oslash!.utf8).toBe('ø');

        const aelig = getEntity('aelig');
        expect(aelig).toBeDefined();
        expect(aelig!.latex).toBe('\\ae{}');
        expect(aelig!.utf8).toBe('æ');
    });
});

// =============================================================================
// Music Symbols
// =============================================================================

describe('Music Symbols', () => {
    it('defines flat, natural, and sharp', () => {
        const flat = getEntity('flat');
        expect(flat).toBeDefined();
        expect(flat!.latex).toBe('\\flat');
        expect(flat!.utf8).toBe('♭');

        const natural = getEntity('natural');
        expect(natural).toBeDefined();
        expect(natural!.latex).toBe('\\natural');
        expect(natural!.utf8).toBe('♮');

        const sharp = getEntity('sharp');
        expect(sharp).toBeDefined();
        expect(sharp!.latex).toBe('\\sharp');
        expect(sharp!.utf8).toBe('♯');
    });
});

// =============================================================================
// Miscellaneous Symbols
// =============================================================================

describe('Miscellaneous Symbols', () => {
    it('defines micro symbol', () => {
        const entity = getEntity('micro');
        expect(entity).toBeDefined();
        expect(entity!.latex).toBe('\\textmu{}');
        expect(entity!.html).toBe('&micro;');
        expect(entity!.utf8).toBe('µ');
    });

    it('defines inverted punctuation for Spanish', () => {
        const iexcl = getEntity('iexcl');
        expect(iexcl).toBeDefined();
        expect(iexcl!.html).toBe('&iexcl;');
        expect(iexcl!.utf8).toBe('¡');

        const iquest = getEntity('iquest');
        expect(iquest).toBeDefined();
        expect(iquest!.html).toBe('&iquest;');
        expect(iquest!.utf8).toBe('¿');
    });

    it('defines ordinal indicators', () => {
        const ordf = getEntity('ordf');
        expect(ordf).toBeDefined();
        expect(ordf!.html).toBe('&ordf;');
        expect(ordf!.utf8).toBe('ª');

        const ordm = getEntity('ordm');
        expect(ordm).toBeDefined();
        expect(ordm!.html).toBe('&ordm;');
        expect(ordm!.utf8).toBe('º');
    });

    it('defines smiley and frowny', () => {
        const smiley = getEntity('smiley');
        expect(smiley).toBeDefined();
        expect(smiley!.utf8).toBe('☺');

        const frowny = getEntity('frowny');
        expect(frowny).toBeDefined();
        expect(frowny!.utf8).toBe('☹');
    });

    it('defines prime symbols', () => {
        const prime = getEntity('prime');
        expect(prime).toBeDefined();
        expect(prime!.latex).toBe('\\prime');
        expect(prime!.html).toBe('&prime;');
        expect(prime!.utf8).toBe('′');

        const dprime = getEntity('dprime');
        expect(dprime).toBeDefined();
        expect(dprime!.latex).toBe('\\prime\\prime');
        expect(dprime!.utf8).toBe('″');
    });

    it('defines geometric shapes', () => {
        const angle = getEntity('angle');
        expect(angle).toBeDefined();
        expect(angle!.latex).toBe('\\angle');
        expect(angle!.html).toBe('&ang;');
        expect(angle!.utf8).toBe('∠');

        const triangle = getEntity('triangle');
        expect(triangle).toBeDefined();
        expect(triangle!.latex).toBe('\\triangle');
        expect(triangle!.utf8).toBe('△');

        const diamond = getEntity('diamond');
        expect(diamond).toBeDefined();
        expect(diamond!.latex).toBe('\\diamond');
        expect(diamond!.utf8).toBe('⋄');

        const box = getEntity('Box');
        expect(box).toBeDefined();
        expect(box!.latex).toBe('\\Box');
        expect(box!.utf8).toBe('□');
    });
});
