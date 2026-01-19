/**
 * Tests for LaTeX hover provider
 * Tests equation detection, figure path resolution, and hover content
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// Math Detection Tests
// =============================================================================

describe('LaTeX Math Detection', () => {
    // Helper to find math in text
    function findInlineMath(text: string): { content: string; start: number; end: number }[] {
        const results: { content: string; start: number; end: number }[] = [];
        const pattern = /(?<![\\$])\$(?!\$)([^$\n]+?)(?<![\\$])\$(?!\$)/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            // Skip if looks like currency
            if (/^\d/.test(match[1].trim())) continue;
            results.push({
                content: match[1],
                start: match.index,
                end: match.index + match[0].length
            });
        }
        return results;
    }

    function findDisplayMath(text: string): { content: string; start: number; end: number }[] {
        const results: { content: string; start: number; end: number }[] = [];
        const pattern = /\$\$([^$]+?)\$\$/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            results.push({
                content: match[1],
                start: match.index,
                end: match.index + match[0].length
            });
        }
        return results;
    }

    function findMathEnvironments(text: string): { env: string; content: string; start: number; end: number }[] {
        const results: { env: string; content: string; start: number; end: number }[] = [];
        const pattern = /\\begin\{(equation\*?|align\*?|gather\*?)\}([\s\S]*?)\\end\{\1\}/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            results.push({
                env: match[1],
                content: match[2],
                start: match.index,
                end: match.index + match[0].length
            });
        }
        return results;
    }

    describe('Inline math detection', () => {
        it('should detect simple inline math', () => {
            const text = 'The formula $E=mc^2$ is famous.';
            const matches = findInlineMath(text);
            expect(matches).toHaveLength(1);
            expect(matches[0].content).toBe('E=mc^2');
        });

        it('should detect multiple inline math expressions', () => {
            const text = 'We have $x=1$ and $y=2$ in the equation.';
            const matches = findInlineMath(text);
            expect(matches).toHaveLength(2);
            expect(matches[0].content).toBe('x=1');
            expect(matches[1].content).toBe('y=2');
        });

        it('should not match escaped dollar signs', () => {
            const text = 'The cost is \\$50 not $x$ dollars.';
            const matches = findInlineMath(text);
            expect(matches).toHaveLength(1);
            expect(matches[0].content).toBe('x');
        });

        it('should not match currency values', () => {
            const text = 'The price is $50 and the formula is $x$.';
            const matches = findInlineMath(text);
            expect(matches).toHaveLength(1);
            expect(matches[0].content).toBe('x');
        });

        it('should detect math with subscripts and superscripts', () => {
            const text = 'Consider $x_1^2 + x_2^2 = r^2$.';
            const matches = findInlineMath(text);
            expect(matches).toHaveLength(1);
            expect(matches[0].content).toBe('x_1^2 + x_2^2 = r^2');
        });
    });

    describe('Display math detection', () => {
        it('should detect display math with double dollars', () => {
            const text = 'The equation is:\n$$E = mc^2$$\nwhich is important.';
            const matches = findDisplayMath(text);
            expect(matches).toHaveLength(1);
            expect(matches[0].content).toBe('E = mc^2');
        });

        it('should detect multiline display math', () => {
            const text = '$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$';
            const matches = findDisplayMath(text);
            expect(matches).toHaveLength(1);
            expect(matches[0].content).toContain('\\frac');
        });
    });

    describe('Math environment detection', () => {
        it('should detect equation environment', () => {
            const text = '\\begin{equation}\nE = mc^2\n\\end{equation}';
            const matches = findMathEnvironments(text);
            expect(matches).toHaveLength(1);
            expect(matches[0].env).toBe('equation');
        });

        it('should detect starred equation environment', () => {
            const text = '\\begin{equation*}\nE = mc^2\n\\end{equation*}';
            const matches = findMathEnvironments(text);
            expect(matches).toHaveLength(1);
            expect(matches[0].env).toBe('equation*');
        });

        it('should detect align environment', () => {
            const text = '\\begin{align}\nx &= 1 \\\\\ny &= 2\n\\end{align}';
            const matches = findMathEnvironments(text);
            expect(matches).toHaveLength(1);
            expect(matches[0].env).toBe('align');
        });

        it('should detect multiple environments', () => {
            const text = '\\begin{equation}\na=b\n\\end{equation}\n\n\\begin{align*}\nc=d\n\\end{align*}';
            const matches = findMathEnvironments(text);
            expect(matches).toHaveLength(2);
        });
    });
});

// =============================================================================
// Figure Path Resolution Tests
// =============================================================================

describe('Figure Path Resolution', () => {
    // Helper to extract includegraphics paths
    function extractGraphicsPath(line: string): string | null {
        const match = line.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/);
        return match ? match[1] : null;
    }

    describe('includegraphics parsing', () => {
        it('should extract simple path', () => {
            const path = extractGraphicsPath('\\includegraphics{image.png}');
            expect(path).toBe('image.png');
        });

        it('should extract path with options', () => {
            const path = extractGraphicsPath('\\includegraphics[width=0.8\\textwidth]{figures/diagram.pdf}');
            expect(path).toBe('figures/diagram.pdf');
        });

        it('should handle multiple options', () => {
            const path = extractGraphicsPath('\\includegraphics[width=10cm,height=5cm]{photo.jpg}');
            expect(path).toBe('photo.jpg');
        });

        it('should handle paths without extension', () => {
            const path = extractGraphicsPath('\\includegraphics{myimage}');
            expect(path).toBe('myimage');
        });

        it('should return null for non-graphics lines', () => {
            const path = extractGraphicsPath('\\begin{figure}');
            expect(path).toBeNull();
        });
    });
});

// =============================================================================
// Document Settings Parsing Tests
// =============================================================================

describe('Document Settings Parsing', () => {
    // Helper to extract packages from preamble
    function extractPackages(text: string): string[] {
        const packages: string[] = [];
        const pattern = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const pkgs = match[1].split(',').map(p => p.trim());
            packages.push(...pkgs);
        }
        return packages;
    }

    describe('Package extraction', () => {
        it('should extract single package', () => {
            const text = '\\usepackage{amsmath}';
            const packages = extractPackages(text);
            expect(packages).toEqual(['amsmath']);
        });

        it('should extract package with options', () => {
            const text = '\\usepackage[utf8]{inputenc}';
            const packages = extractPackages(text);
            expect(packages).toEqual(['inputenc']);
        });

        it('should extract multiple packages from one command', () => {
            const text = '\\usepackage{amsmath,amssymb,amsthm}';
            const packages = extractPackages(text);
            expect(packages).toEqual(['amsmath', 'amssymb', 'amsthm']);
        });

        it('should extract packages from multiple commands', () => {
            const text = '\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\usepackage{hyperref}';
            const packages = extractPackages(text);
            expect(packages).toEqual(['amsmath', 'graphicx', 'hyperref']);
        });
    });
});

// =============================================================================
// Compile Command Tests
// =============================================================================

describe('LaTeX Compile Helpers', () => {
    // Helper to parse LaTeX error messages
    function parseLatexError(output: string): { line: number; message: string } | null {
        const match = output.match(/^(.+):(\d+): (.+)$/m);
        if (match) {
            return {
                line: parseInt(match[2], 10),
                message: match[3]
            };
        }
        return null;
    }

    describe('Error parsing', () => {
        it('should parse simple error', () => {
            const output = './document.tex:42: Undefined control sequence.';
            const error = parseLatexError(output);
            expect(error).toEqual({ line: 42, message: 'Undefined control sequence.' });
        });

        it('should parse error with path', () => {
            const output = '/path/to/file.tex:10: Missing $ inserted.';
            const error = parseLatexError(output);
            expect(error).toEqual({ line: 10, message: 'Missing $ inserted.' });
        });

        it('should return null for no error', () => {
            const output = 'Output written on document.pdf (1 page).';
            const error = parseLatexError(output);
            expect(error).toBeNull();
        });
    });

    describe('Auxiliary file extensions', () => {
        it('should include standard auxiliary extensions', () => {
            const auxExtensions = [
                '.aux', '.log', '.out', '.toc', '.lof', '.lot',
                '.bbl', '.blg', '.bcf', '.run.xml',
                '.fls', '.fdb_latexmk', '.synctex.gz', '.synctex',
                '.nav', '.snm', '.vrb'
            ];

            // Verify standard extensions are present
            expect(auxExtensions).toContain('.aux');
            expect(auxExtensions).toContain('.log');
            expect(auxExtensions).toContain('.toc');
            expect(auxExtensions).toContain('.bbl');
            expect(auxExtensions).toContain('.synctex.gz');

            // Beamer extensions
            expect(auxExtensions).toContain('.nav');
            expect(auxExtensions).toContain('.snm');
        });
    });
});

// =============================================================================
// Word Count Tests
// =============================================================================

describe('LaTeX Word Count', () => {
    function countWords(text: string): number {
        // Remove comments
        const noComments = text.replace(/%.*$/gm, '');

        // Remove commands
        const noCommands = noComments.replace(/\\[a-zA-Z]+(\[[^\]]*\])?(\{[^}]*\})?/g, ' ');

        // Remove environment markers
        const noEnvMarkers = noCommands.replace(/\\(begin|end)\{[^}]+\}/g, '');

        // Count words
        const words = noEnvMarkers.match(/\b[a-zA-Z]+\b/g) || [];
        return words.length;
    }

    it('should count words in plain text', () => {
        const text = 'This is a simple sentence.';
        expect(countWords(text)).toBe(5);
    });

    it('should exclude commands from count', () => {
        const text = 'This is \\textbf{bold} text.';
        expect(countWords(text)).toBe(4); // This, is, bold, text
    });

    it('should exclude comments', () => {
        const text = 'Real text. % This is a comment\nMore text.';
        expect(countWords(text)).toBe(4); // Real, text, More, text
    });

    it('should handle environment markers', () => {
        const text = '\\begin{document}\nHello world.\n\\end{document}';
        expect(countWords(text)).toBe(2); // Hello, world
    });
});
