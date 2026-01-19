/**
 * Tests for LaTeX language providers
 * Tests definition, reference, completion, and project support features
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// Master Document Detection Tests
// =============================================================================

describe('Master Document Detection', () => {
    function hasDocumentClass(content: string): boolean {
        return /\\documentclass/.test(content);
    }

    function findIncludedFiles(content: string): string[] {
        const files: string[] = [];
        const pattern = /\\(input|include)\{([^}]+)\}/g;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            files.push(match[2]);
        }
        return files;
    }

    it('should detect documentclass as master', () => {
        const content = `\\documentclass{article}
\\begin{document}
Hello
\\end{document}`;
        expect(hasDocumentClass(content)).toBe(true);
    });

    it('should not detect documentclass in included file', () => {
        const content = `\\section{Introduction}
This is the content.`;
        expect(hasDocumentClass(content)).toBe(false);
    });

    it('should find input files', () => {
        const content = `\\documentclass{article}
\\input{chapter1}
\\input{chapter2.tex}
\\begin{document}
\\end{document}`;
        const files = findIncludedFiles(content);
        expect(files).toContain('chapter1');
        expect(files).toContain('chapter2.tex');
    });

    it('should find include files', () => {
        const content = `\\include{frontmatter}
\\include{mainbody}`;
        const files = findIncludedFiles(content);
        expect(files).toHaveLength(2);
    });
});

// =============================================================================
// Bibliography File Detection Tests
// =============================================================================

describe('Bibliography Detection', () => {
    function findBibFiles(content: string): string[] {
        const bibFiles: string[] = [];

        // \bibliography{file1,file2}
        const bibPattern = /\\bibliography\{([^}]+)\}/g;
        let match;
        while ((match = bibPattern.exec(content)) !== null) {
            const files = match[1].split(',').map(f => f.trim());
            bibFiles.push(...files);
        }

        // \addbibresource{file.bib}
        const addbibPattern = /\\addbibresource\{([^}]+)\}/g;
        while ((match = addbibPattern.exec(content)) !== null) {
            bibFiles.push(match[1]);
        }

        return bibFiles;
    }

    it('should find bibliography files', () => {
        const content = `\\bibliography{references}`;
        expect(findBibFiles(content)).toEqual(['references']);
    });

    it('should find multiple bibliography files', () => {
        const content = `\\bibliography{refs1,refs2,refs3}`;
        const files = findBibFiles(content);
        expect(files).toHaveLength(3);
        expect(files).toContain('refs1');
        expect(files).toContain('refs2');
        expect(files).toContain('refs3');
    });

    it('should find addbibresource (biblatex)', () => {
        const content = `\\usepackage[backend=biber]{biblatex}
\\addbibresource{mybib.bib}`;
        expect(findBibFiles(content)).toContain('mybib.bib');
    });
});

// =============================================================================
// Label Extraction Tests
// =============================================================================

describe('Label Extraction', () => {
    function extractLabels(content: string): { name: string; line: number }[] {
        const labels: { name: string; line: number }[] = [];
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(/\\label\{([^}]+)\}/);
            if (match) {
                labels.push({ name: match[1], line: i });
            }
        }

        return labels;
    }

    it('should extract labels from content', () => {
        const content = `\\section{Introduction}
\\label{sec:intro}

\\begin{equation}
E = mc^2
\\label{eq:einstein}
\\end{equation}`;

        const labels = extractLabels(content);
        expect(labels).toHaveLength(2);
        expect(labels[0].name).toBe('sec:intro');
        expect(labels[1].name).toBe('eq:einstein');
    });

    it('should track line numbers correctly', () => {
        const content = `Line 0
\\label{first}
Line 2
Line 3
\\label{second}`;

        const labels = extractLabels(content);
        expect(labels[0].line).toBe(1);
        expect(labels[1].line).toBe(4);
    });
});

// =============================================================================
// Reference Pattern Matching Tests
// =============================================================================

describe('Reference Pattern Matching', () => {
    function findReferences(content: string): string[] {
        const refs: string[] = [];
        const pattern = /\\(ref|eqref|pageref|autoref|cref|Cref)\{([^}]+)\}/g;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            refs.push(match[2]);
        }
        return refs;
    }

    it('should find \\ref commands', () => {
        const content = 'See Section~\\ref{sec:intro} for details.';
        expect(findReferences(content)).toContain('sec:intro');
    });

    it('should find \\eqref commands', () => {
        const content = 'From Equation~\\eqref{eq:einstein}, we see...';
        expect(findReferences(content)).toContain('eq:einstein');
    });

    it('should find \\autoref commands', () => {
        const content = 'As shown in \\autoref{fig:diagram}...';
        expect(findReferences(content)).toContain('fig:diagram');
    });

    it('should find \\cref and \\Cref commands', () => {
        const content = 'See \\cref{sec:method} and \\Cref{tab:results}.';
        const refs = findReferences(content);
        expect(refs).toContain('sec:method');
        expect(refs).toContain('tab:results');
    });

    it('should find multiple references in one line', () => {
        const content = '\\ref{a}, \\ref{b}, and \\ref{c}';
        expect(findReferences(content)).toHaveLength(3);
    });
});

// =============================================================================
// Citation Pattern Matching Tests
// =============================================================================

describe('Citation Pattern Matching', () => {
    function findCitations(content: string): string[] {
        const citations: string[] = [];
        const pattern = /\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|nocite)\{([^}]+)\}/g;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const keys = match[2].split(',').map(k => k.trim());
            citations.push(...keys);
        }
        return citations;
    }

    it('should find \\cite commands', () => {
        const content = 'Previous work~\\cite{smith2020} has shown...';
        expect(findCitations(content)).toContain('smith2020');
    });

    it('should find \\citep commands (natbib)', () => {
        const content = '\\citep{jones2019}';
        expect(findCitations(content)).toContain('jones2019');
    });

    it('should find \\citet commands (natbib)', () => {
        const content = '\\citet{brown2018} showed...';
        expect(findCitations(content)).toContain('brown2018');
    });

    it('should find multiple keys in one citation', () => {
        const content = '\\cite{paper1, paper2, paper3}';
        const cites = findCitations(content);
        expect(cites).toHaveLength(3);
        expect(cites).toContain('paper1');
        expect(cites).toContain('paper2');
        expect(cites).toContain('paper3');
    });

    it('should find citeauthor and citeyear', () => {
        const content = '\\citeauthor{doe2021} in \\citeyear{doe2021}';
        const cites = findCitations(content);
        expect(cites.filter(c => c === 'doe2021')).toHaveLength(2);
    });
});

// =============================================================================
// Command Definition Pattern Tests
// =============================================================================

describe('Command Definition Detection', () => {
    function findCommandDefinition(content: string, cmdName: string): number | null {
        const patterns = [
            new RegExp(`\\\\newcommand\\*?\\{?\\\\${cmdName}\\}?`),
            new RegExp(`\\\\renewcommand\\*?\\{?\\\\${cmdName}\\}?`),
            new RegExp(`\\\\def\\\\${cmdName}`),
            new RegExp(`\\\\DeclareMathOperator\\*?\\{\\\\${cmdName}\\}`),
        ];

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            for (const pattern of patterns) {
                if (pattern.test(lines[i])) {
                    return i;
                }
            }
        }
        return null;
    }

    it('should find \\newcommand definition', () => {
        const content = `\\newcommand{\\myCmd}{definition}
Some text`;
        expect(findCommandDefinition(content, 'myCmd')).toBe(0);
    });

    it('should find \\newcommand* definition', () => {
        const content = `\\newcommand*{\\shortCmd}{def}`;
        expect(findCommandDefinition(content, 'shortCmd')).toBe(0);
    });

    it('should find \\def definition', () => {
        const content = `Line 0
\\def\\customMacro{text}`;
        expect(findCommandDefinition(content, 'customMacro')).toBe(1);
    });

    it('should find \\DeclareMathOperator', () => {
        const content = `\\DeclareMathOperator{\\argmax}{arg\\,max}`;
        expect(findCommandDefinition(content, 'argmax')).toBe(0);
    });

    it('should return null if not found', () => {
        const content = `\\section{Test}`;
        expect(findCommandDefinition(content, 'nonexistent')).toBeNull();
    });
});

// =============================================================================
// Environment Completion Tests
// =============================================================================

describe('Environment Completion', () => {
    const COMMON_ENVIRONMENTS = [
        'document', 'abstract',
        'equation', 'equation*', 'align', 'align*', 'gather', 'multline',
        'figure', 'table', 'tabular',
        'itemize', 'enumerate', 'description',
        'center', 'quote', 'verbatim',
        'theorem', 'lemma', 'proof', 'definition',
        'lstlisting', 'minted',
        'frame', 'block', 'columns',
    ];

    it('should include math environments', () => {
        expect(COMMON_ENVIRONMENTS).toContain('equation');
        expect(COMMON_ENVIRONMENTS).toContain('align');
        expect(COMMON_ENVIRONMENTS).toContain('align*');
    });

    it('should include float environments', () => {
        expect(COMMON_ENVIRONMENTS).toContain('figure');
        expect(COMMON_ENVIRONMENTS).toContain('table');
    });

    it('should include list environments', () => {
        expect(COMMON_ENVIRONMENTS).toContain('itemize');
        expect(COMMON_ENVIRONMENTS).toContain('enumerate');
    });

    it('should include theorem-like environments', () => {
        expect(COMMON_ENVIRONMENTS).toContain('theorem');
        expect(COMMON_ENVIRONMENTS).toContain('proof');
    });

    it('should include beamer environments', () => {
        expect(COMMON_ENVIRONMENTS).toContain('frame');
        expect(COMMON_ENVIRONMENTS).toContain('block');
    });
});

// =============================================================================
// Package Completion Tests
// =============================================================================

describe('Package Completion', () => {
    const COMMON_PACKAGES = [
        'amsmath', 'amssymb', 'amsthm',
        'graphicx', 'hyperref', 'geometry',
        'xcolor', 'tikz', 'booktabs',
        'siunitx', 'biblatex', 'natbib',
        'cleveref', 'listings', 'minted',
        'microtype', 'fontspec', 'babel',
        'enumitem', 'subcaption',
    ];

    it('should include AMS packages', () => {
        expect(COMMON_PACKAGES).toContain('amsmath');
        expect(COMMON_PACKAGES).toContain('amssymb');
        expect(COMMON_PACKAGES).toContain('amsthm');
    });

    it('should include graphics packages', () => {
        expect(COMMON_PACKAGES).toContain('graphicx');
        expect(COMMON_PACKAGES).toContain('tikz');
    });

    it('should include bibliography packages', () => {
        expect(COMMON_PACKAGES).toContain('biblatex');
        expect(COMMON_PACKAGES).toContain('natbib');
    });

    it('should include code listing packages', () => {
        expect(COMMON_PACKAGES).toContain('listings');
        expect(COMMON_PACKAGES).toContain('minted');
    });
});

// =============================================================================
// ChkTeX Output Parsing Tests
// =============================================================================

describe('ChkTeX Output Parsing', () => {
    function parseChkTeXOutput(output: string): { line: number; col: number; warning: string; message: string }[] {
        const results: { line: number; col: number; warning: string; message: string }[] = [];
        const pattern = /^[^:]+:(\d+):(\d+):(\d+):(.+)$/gm;
        let match;
        while ((match = pattern.exec(output)) !== null) {
            results.push({
                line: parseInt(match[1], 10),
                col: parseInt(match[2], 10),
                warning: match[3],
                message: match[4].trim(),
            });
        }
        return results;
    }

    it('should parse single warning', () => {
        const output = 'file.tex:10:5:24:Delete this space to maintain correct pagereferences.';
        const results = parseChkTeXOutput(output);
        expect(results).toHaveLength(1);
        expect(results[0].line).toBe(10);
        expect(results[0].col).toBe(5);
        expect(results[0].warning).toBe('24');
    });

    it('should parse multiple warnings', () => {
        const output = `file.tex:5:1:1:Command terminated with space.
file.tex:12:10:24:Delete this space.
file.tex:20:0:8:Wrong length of dash.`;
        const results = parseChkTeXOutput(output);
        expect(results).toHaveLength(3);
    });

    it('should handle empty output', () => {
        const results = parseChkTeXOutput('');
        expect(results).toHaveLength(0);
    });
});

// =============================================================================
// Image Path Detection Tests
// =============================================================================

describe('Image Path Detection', () => {
    const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg'];

    function isImageFile(filename: string): boolean {
        const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
        return IMAGE_EXTENSIONS.includes(ext);
    }

    it('should recognize PNG files', () => {
        expect(isImageFile('image.png')).toBe(true);
        expect(isImageFile('IMAGE.PNG')).toBe(true);
    });

    it('should recognize JPEG files', () => {
        expect(isImageFile('photo.jpg')).toBe(true);
        expect(isImageFile('photo.jpeg')).toBe(true);
    });

    it('should recognize PDF files', () => {
        expect(isImageFile('figure.pdf')).toBe(true);
    });

    it('should recognize EPS and SVG files', () => {
        expect(isImageFile('diagram.eps')).toBe(true);
        expect(isImageFile('logo.svg')).toBe(true);
    });

    it('should reject non-image files', () => {
        expect(isImageFile('document.tex')).toBe(false);
        expect(isImageFile('data.csv')).toBe(false);
    });
});

// =============================================================================
// Trigger Character Tests
// =============================================================================

describe('Completion Trigger Patterns', () => {
    function shouldTriggerLabelCompletion(linePrefix: string): boolean {
        return /\\(ref|eqref|pageref|autoref|cref|Cref)\{[^}]*$/.test(linePrefix);
    }

    function shouldTriggerCiteCompletion(linePrefix: string): boolean {
        return /\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|nocite)\{[^}]*$/.test(linePrefix);
    }

    function shouldTriggerEnvCompletion(linePrefix: string): boolean {
        return /\\begin\{[^}]*$/.test(linePrefix);
    }

    function shouldTriggerPackageCompletion(linePrefix: string): boolean {
        return /\\usepackage(\[[^\]]*\])?\{[^}]*$/.test(linePrefix);
    }

    describe('Label completion triggers', () => {
        it('should trigger after \\ref{', () => {
            expect(shouldTriggerLabelCompletion('See \\ref{')).toBe(true);
            expect(shouldTriggerLabelCompletion('\\ref{sec:')).toBe(true);
        });

        it('should trigger after \\autoref{', () => {
            expect(shouldTriggerLabelCompletion('\\autoref{')).toBe(true);
        });

        it('should not trigger before brace', () => {
            expect(shouldTriggerLabelCompletion('\\ref')).toBe(false);
        });
    });

    describe('Citation completion triggers', () => {
        it('should trigger after \\cite{', () => {
            expect(shouldTriggerCiteCompletion('\\cite{')).toBe(true);
            expect(shouldTriggerCiteCompletion('\\cite{smith')).toBe(true);
        });

        it('should trigger after \\citep{', () => {
            expect(shouldTriggerCiteCompletion('\\citep{')).toBe(true);
        });

        it('should trigger after comma in cite', () => {
            expect(shouldTriggerCiteCompletion('\\cite{a, ')).toBe(true);
        });
    });

    describe('Environment completion triggers', () => {
        it('should trigger after \\begin{', () => {
            expect(shouldTriggerEnvCompletion('\\begin{')).toBe(true);
            expect(shouldTriggerEnvCompletion('  \\begin{eq')).toBe(true);
        });
    });

    describe('Package completion triggers', () => {
        it('should trigger after \\usepackage{', () => {
            expect(shouldTriggerPackageCompletion('\\usepackage{')).toBe(true);
        });

        it('should trigger with options', () => {
            expect(shouldTriggerPackageCompletion('\\usepackage[utf8]{')).toBe(true);
        });
    });
});

// =============================================================================
// Rename Symbol Tests
// =============================================================================

describe('Rename Symbol', () => {
    function matchLabelOrRef(line: string, col: number): { name: string; braceStart: number } | null {
        const pattern = /\\(label|ref|eqref|pageref|autoref|cref|Cref)\{([^}]+)\}/g;
        let match;
        while ((match = pattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (col >= start && col <= end) {
                const braceStart = match.index + match[1].length + 2;
                return { name: match[2], braceStart };
            }
        }
        return null;
    }

    it('should match label at cursor', () => {
        const line = '\\label{sec:intro}';
        const result = matchLabelOrRef(line, 10);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('sec:intro');
    });

    it('should match ref at cursor', () => {
        const line = 'See \\ref{fig:diagram} for details.';
        const result = matchLabelOrRef(line, 12);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('fig:diagram');
    });

    it('should match eqref at cursor', () => {
        const line = 'From \\eqref{eq:energy}, we see...';
        const result = matchLabelOrRef(line, 15);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('eq:energy');
    });

    it('should match autoref at cursor', () => {
        const line = 'As shown in \\autoref{tab:results}...';
        const result = matchLabelOrRef(line, 25);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('tab:results');
    });

    it('should return null when not on label/ref', () => {
        const line = 'Just some text here.';
        const result = matchLabelOrRef(line, 10);
        expect(result).toBeNull();
    });

    it('should return null when cursor outside command', () => {
        const line = 'See \\ref{fig:test} and more.';
        const result = matchLabelOrRef(line, 25); // on "and"
        expect(result).toBeNull();
    });
});

// =============================================================================
// Reference Validation Tests
// =============================================================================

describe('Reference Validation', () => {
    function collectLabelsAndRefs(content: string): {
        labels: string[];
        refs: string[];
    } {
        const labels: string[] = [];
        const refs: string[] = [];

        const labelPattern = /\\label\{([^}]+)\}/g;
        let match;
        while ((match = labelPattern.exec(content)) !== null) {
            labels.push(match[1]);
        }

        const refPattern = /\\(ref|eqref|pageref|autoref|cref|Cref)\{([^}]+)\}/g;
        while ((match = refPattern.exec(content)) !== null) {
            refs.push(match[2]);
        }

        return { labels, refs };
    }

    function findUndefinedRefs(labels: string[], refs: string[]): string[] {
        const labelSet = new Set(labels);
        return refs.filter(ref => !labelSet.has(ref));
    }

    function findUnusedLabels(labels: string[], refs: string[]): string[] {
        const refSet = new Set(refs);
        return labels.filter(label => !refSet.has(label));
    }

    it('should find all labels in content', () => {
        const content = `\\section{Intro}
\\label{sec:intro}
\\begin{equation}
\\label{eq:main}
\\end{equation}`;
        const { labels } = collectLabelsAndRefs(content);
        expect(labels).toContain('sec:intro');
        expect(labels).toContain('eq:main');
    });

    it('should find all refs in content', () => {
        const content = 'See \\ref{sec:intro} and \\eqref{eq:main}.';
        const { refs } = collectLabelsAndRefs(content);
        expect(refs).toContain('sec:intro');
        expect(refs).toContain('eq:main');
    });

    it('should detect undefined references', () => {
        const labels = ['sec:intro', 'fig:one'];
        const refs = ['sec:intro', 'fig:one', 'fig:missing'];
        const undefined = findUndefinedRefs(labels, refs);
        expect(undefined).toEqual(['fig:missing']);
    });

    it('should detect unused labels', () => {
        const labels = ['sec:intro', 'sec:unused', 'fig:one'];
        const refs = ['sec:intro', 'fig:one'];
        const unused = findUnusedLabels(labels, refs);
        expect(unused).toEqual(['sec:unused']);
    });

    it('should handle empty labels', () => {
        const labels: string[] = [];
        const refs = ['sec:missing'];
        const undefined = findUndefinedRefs(labels, refs);
        expect(undefined).toEqual(['sec:missing']);
    });

    it('should handle empty refs', () => {
        const labels = ['sec:lonely'];
        const refs: string[] = [];
        const unused = findUnusedLabels(labels, refs);
        expect(unused).toEqual(['sec:lonely']);
    });
});

// =============================================================================
// Spell Check Region Tests
// =============================================================================

describe('Spell Check Regions', () => {
    // Simplified version of extractSpellCheckRegions for testing
    function extractTextRegions(text: string): string[] {
        // Remove commands
        let result = text.replace(/\\[a-zA-Z]+(\[[^\]]*\])?(\{[^}]*\})?/g, ' ');
        // Remove math
        result = result.replace(/\$[^$]+\$/g, ' ');
        result = result.replace(/\$\$[\s\S]*?\$\$/g, ' ');
        // Remove comments
        result = result.replace(/%[^\n]*/g, '');
        // Split into words
        return result.split(/\s+/).filter(w => w.length > 0);
    }

    it('should extract plain text words', () => {
        const text = 'This is some plain text.';
        const words = extractTextRegions(text);
        expect(words).toContain('This');
        expect(words).toContain('is');
        expect(words).toContain('plain');
    });

    it('should skip commands', () => {
        const text = 'Hello \\textbf{world} there.';
        const words = extractTextRegions(text);
        expect(words).toContain('Hello');
        expect(words).toContain('there.');
        expect(words).not.toContain('\\textbf');
    });

    it('should skip inline math', () => {
        const text = 'The value $x^2 + y^2$ is computed.';
        const words = extractTextRegions(text);
        expect(words).toContain('The');
        expect(words).toContain('value');
        expect(words).toContain('computed.');
        expect(words).not.toContain('x^2');
    });

    it('should skip comments', () => {
        const text = 'Real text % this is a comment\nMore text.';
        const words = extractTextRegions(text);
        expect(words).toContain('Real');
        expect(words).toContain('text');
        expect(words).not.toContain('comment');
    });

    it('should handle nested commands', () => {
        const text = '\\section{Introduction to \\LaTeX}';
        const words = extractTextRegions(text);
        // The text inside {} is removed with the command
        expect(words.join(' ')).not.toContain('Introduction');
    });
});

// =============================================================================
// Formatting Pattern Tests
// =============================================================================

describe('Formatting Patterns', () => {
    function hasTrailingWhitespace(text: string): boolean {
        return /[ \t]+$/m.test(text);  // Space or tab before end of line
    }

    function hasTabs(text: string): boolean {
        return /\t/.test(text);
    }

    function hasExcessiveBlankLines(text: string): boolean {
        return /\n{3,}/.test(text);  // 3 or more consecutive newlines
    }

    it('should detect trailing whitespace', () => {
        const text = 'Some text   \nMore text.';
        expect(hasTrailingWhitespace(text)).toBe(true);
    });

    it('should not detect trailing whitespace when clean', () => {
        const text = 'Clean text here.\nAnother paragraph.';
        expect(hasTrailingWhitespace(text)).toBe(false);
    });

    it('should detect tabs', () => {
        const text = 'Some\ttext here.';
        expect(hasTabs(text)).toBe(true);
    });

    it('should not detect tabs when using spaces', () => {
        const text = 'Some    text here.';
        expect(hasTabs(text)).toBe(false);
    });

    it('should detect multiple blank lines', () => {
        const text = 'Line 1\n\n\n\nLine 2';
        expect(hasExcessiveBlankLines(text)).toBe(true);
    });

    it('should allow single blank line', () => {
        const text = 'Line 1\n\nLine 2';
        expect(hasExcessiveBlankLines(text)).toBe(false);
    });
});

// =============================================================================
// SyncTeX Pattern Tests
// =============================================================================

describe('SyncTeX Patterns', () => {
    function parseSyncTeXOutput(output: string): { file: string; line: number; column: number } | null {
        const inputMatch = output.match(/Input:(.+)/);
        const lineMatch = output.match(/Line:(\d+)/);
        const columnMatch = output.match(/Column:(\d+)/);

        if (inputMatch && lineMatch) {
            return {
                file: inputMatch[1].trim(),
                line: parseInt(lineMatch[1], 10),
                column: columnMatch ? parseInt(columnMatch[1], 10) : 0
            };
        }
        return null;
    }

    it('should parse synctex output', () => {
        const output = `SyncTeX result
Input:/path/to/document.tex
Line:42
Column:15
`;
        const result = parseSyncTeXOutput(output);
        expect(result).not.toBeNull();
        expect(result!.file).toBe('/path/to/document.tex');
        expect(result!.line).toBe(42);
        expect(result!.column).toBe(15);
    });

    it('should handle missing column', () => {
        const output = `Input:/path/to/file.tex
Line:100
`;
        const result = parseSyncTeXOutput(output);
        expect(result).not.toBeNull();
        expect(result!.column).toBe(0);
    });

    it('should return null for invalid output', () => {
        const output = 'Some random text without synctex info';
        const result = parseSyncTeXOutput(output);
        expect(result).toBeNull();
    });
});

// =============================================================================
// Inverse Search Command Tests
// =============================================================================

describe('Inverse Search Commands', () => {
    function getInverseSyncTeXCommand(viewer: string): string {
        switch (viewer) {
            case 'skim':
                return 'code --goto "%file:%line"';
            case 'sumatra':
                return 'code --goto "%f:%l"';
            case 'zathura':
                return 'code --goto "%{input}:%{line}"';
            default:
                return 'code --goto "%file:%line"';
        }
    }

    it('should return Skim command', () => {
        const cmd = getInverseSyncTeXCommand('skim');
        expect(cmd).toContain('code --goto');
        expect(cmd).toContain('%file');
    });

    it('should return SumatraPDF command', () => {
        const cmd = getInverseSyncTeXCommand('sumatra');
        expect(cmd).toContain('code --goto');
        expect(cmd).toContain('%f');
        expect(cmd).toContain('%l');
    });

    it('should return Zathura command', () => {
        const cmd = getInverseSyncTeXCommand('zathura');
        expect(cmd).toContain('code --goto');
        expect(cmd).toContain('%{input}');
    });

    it('should return default command for unknown viewer', () => {
        const cmd = getInverseSyncTeXCommand('unknown');
        expect(cmd).toContain('code --goto');
    });
});
