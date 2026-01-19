/**
 * Tests for LaTeX document parsing and symbol provider
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseLatexDocument,
    getSectionLevel,
    getSectionTypeAtLevel,
    LaTeXSection,
    LaTeXEnvironment,
    LaTeXLabel
} from '../latexDocumentSymbolProvider';

// Mock vscode TextDocument
function createMockDocument(content: string): any {
    const lines = content.split('\n');
    return {
        getText: () => content,
        lineAt: (line: number) => ({
            text: lines[line] || '',
            range: { start: { line, character: 0 }, end: { line, character: (lines[line] || '').length } }
        }),
        lineCount: lines.length,
        uri: { toString: () => 'test://document.tex', fsPath: '/test/document.tex' },
        version: 1,
        languageId: 'latex'
    };
}

// =============================================================================
// Section Level Tests
// =============================================================================

describe('LaTeX Section Levels', () => {
    describe('getSectionLevel', () => {
        it('should return correct levels for standard sections', () => {
            expect(getSectionLevel('part')).toBe(0);
            expect(getSectionLevel('chapter')).toBe(1);
            expect(getSectionLevel('section')).toBe(2);
            expect(getSectionLevel('subsection')).toBe(3);
            expect(getSectionLevel('subsubsection')).toBe(4);
            expect(getSectionLevel('paragraph')).toBe(5);
            expect(getSectionLevel('subparagraph')).toBe(6);
        });

        it('should return default level for unknown section types', () => {
            expect(getSectionLevel('unknown')).toBe(2);
        });
    });

    describe('getSectionTypeAtLevel', () => {
        it('should return correct section type for each level', () => {
            expect(getSectionTypeAtLevel(0)).toBe('part');
            expect(getSectionTypeAtLevel(1)).toBe('chapter');
            expect(getSectionTypeAtLevel(2)).toBe('section');
            expect(getSectionTypeAtLevel(3)).toBe('subsection');
            expect(getSectionTypeAtLevel(4)).toBe('subsubsection');
            expect(getSectionTypeAtLevel(5)).toBe('paragraph');
            expect(getSectionTypeAtLevel(6)).toBe('subparagraph');
        });

        it('should clamp to valid range', () => {
            expect(getSectionTypeAtLevel(-1)).toBe('part');
            expect(getSectionTypeAtLevel(100)).toBe('subparagraph');
        });
    });
});

// =============================================================================
// Section Parsing Tests
// =============================================================================

describe('LaTeX Section Parsing', () => {
    it('should parse simple sections', () => {
        const doc = createMockDocument(`
\\section{Introduction}
Some text here.

\\section{Methods}
More text.
`);
        const { sections } = parseLatexDocument(doc);

        expect(sections).toHaveLength(2);
        expect(sections[0].title).toBe('Introduction');
        expect(sections[0].type).toBe('section');
        expect(sections[0].level).toBe(2);
        expect(sections[0].starred).toBe(false);

        expect(sections[1].title).toBe('Methods');
    });

    it('should parse nested sections', () => {
        const doc = createMockDocument(`
\\section{Introduction}
\\subsection{Background}
\\subsubsection{History}
\\section{Conclusion}
`);
        const { sections } = parseLatexDocument(doc);

        expect(sections).toHaveLength(4);
        expect(sections[0].type).toBe('section');
        expect(sections[0].level).toBe(2);

        expect(sections[1].type).toBe('subsection');
        expect(sections[1].level).toBe(3);

        expect(sections[2].type).toBe('subsubsection');
        expect(sections[2].level).toBe(4);

        expect(sections[3].type).toBe('section');
        expect(sections[3].level).toBe(2);
    });

    it('should parse starred sections', () => {
        const doc = createMockDocument(`
\\section*{Preface}
\\section{Chapter One}
`);
        const { sections } = parseLatexDocument(doc);

        expect(sections).toHaveLength(2);
        expect(sections[0].title).toBe('Preface');
        expect(sections[0].starred).toBe(true);

        expect(sections[1].title).toBe('Chapter One');
        expect(sections[1].starred).toBe(false);
    });

    it('should parse sections with short titles', () => {
        const doc = createMockDocument(`
\\section[Short]{A Very Long Section Title That Would Be Too Long for TOC}
`);
        const { sections } = parseLatexDocument(doc);

        expect(sections).toHaveLength(1);
        expect(sections[0].title).toBe('A Very Long Section Title That Would Be Too Long for TOC');
        expect(sections[0].shortTitle).toBe('Short');
    });

    it('should handle all section levels', () => {
        const doc = createMockDocument(`
\\part{Part One}
\\chapter{Chapter One}
\\section{Section One}
\\subsection{Subsection One}
\\subsubsection{Subsubsection One}
\\paragraph{Paragraph One}
\\subparagraph{Subparagraph One}
`);
        const { sections } = parseLatexDocument(doc);

        expect(sections).toHaveLength(7);
        expect(sections.map(s => s.type)).toEqual([
            'part', 'chapter', 'section', 'subsection',
            'subsubsection', 'paragraph', 'subparagraph'
        ]);
        expect(sections.map(s => s.level)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('should track line numbers correctly', () => {
        const doc = createMockDocument(`Line 0
\\section{First}
Line 2
\\section{Second}
`);
        const { sections } = parseLatexDocument(doc);

        expect(sections[0].line).toBe(1);
        expect(sections[1].line).toBe(3);
    });
});

// =============================================================================
// Environment Parsing Tests
// =============================================================================

describe('LaTeX Environment Parsing', () => {
    it('should parse simple environments', () => {
        const doc = createMockDocument(`
\\begin{figure}
  Content here
\\end{figure}
`);
        const { environments } = parseLatexDocument(doc);

        expect(environments).toHaveLength(1);
        expect(environments[0].name).toBe('figure');
        expect(environments[0].line).toBe(1);
        expect(environments[0].endLine).toBe(3);
    });

    it('should parse nested environments', () => {
        const doc = createMockDocument(`
\\begin{figure}
  \\begin{center}
    Content
  \\end{center}
\\end{figure}
`);
        const { environments } = parseLatexDocument(doc);

        expect(environments).toHaveLength(2);
        // Inner environment closes first
        expect(environments[0].name).toBe('center');
        expect(environments[1].name).toBe('figure');
    });

    it('should capture labels in environments', () => {
        const doc = createMockDocument(`
\\begin{figure}
  \\label{fig:example}
  Content
\\end{figure}
`);
        const { environments } = parseLatexDocument(doc);

        expect(environments[0].label).toBe('fig:example');
    });

    it('should capture captions', () => {
        const doc = createMockDocument(`
\\begin{figure}
  \\caption{This is a figure caption}
\\end{figure}
`);
        const { environments } = parseLatexDocument(doc);

        expect(environments[0].caption).toBe('This is a figure caption');
    });

    it('should parse multiple environments', () => {
        const doc = createMockDocument(`
\\begin{equation}
  E = mc^2
\\end{equation}

\\begin{table}
  \\begin{tabular}{cc}
    A & B
  \\end{tabular}
\\end{table}
`);
        const { environments } = parseLatexDocument(doc);

        expect(environments).toHaveLength(3);
        expect(environments.map(e => e.name)).toContain('equation');
        expect(environments.map(e => e.name)).toContain('table');
        expect(environments.map(e => e.name)).toContain('tabular');
    });
});

// =============================================================================
// Label Parsing Tests
// =============================================================================

describe('LaTeX Label Parsing', () => {
    it('should parse labels', () => {
        const doc = createMockDocument(`
\\section{Introduction}
\\label{sec:intro}

Some text with a reference.
`);
        const { labels } = parseLatexDocument(doc);

        expect(labels).toHaveLength(1);
        expect(labels[0].name).toBe('sec:intro');
        expect(labels[0].line).toBe(2);
    });

    it('should associate labels with sections', () => {
        const doc = createMockDocument(`
\\section{Methods}
\\label{sec:methods}
`);
        const { labels } = parseLatexDocument(doc);

        expect(labels[0].context).toBe('section: Methods');
    });

    it('should associate labels with environments', () => {
        const doc = createMockDocument(`
\\begin{figure}
  \\label{fig:example}
\\end{figure}
`);
        const { labels } = parseLatexDocument(doc);

        expect(labels[0].context).toBe('figure');
    });

    it('should parse multiple labels', () => {
        const doc = createMockDocument(`
\\section{One}
\\label{sec:one}

\\section{Two}
\\label{sec:two}

\\begin{equation}
\\label{eq:main}
\\end{equation}
`);
        const { labels } = parseLatexDocument(doc);

        expect(labels).toHaveLength(3);
        expect(labels.map(l => l.name)).toEqual(['sec:one', 'sec:two', 'eq:main']);
    });
});

// =============================================================================
// Complex Document Tests
// =============================================================================

describe('Complex LaTeX Document Parsing', () => {
    it('should parse a complete document', () => {
        const doc = createMockDocument(`
\\documentclass{article}
\\begin{document}

\\section{Introduction}
\\label{sec:intro}
This is the introduction.

\\subsection{Background}
\\label{sec:background}
Some background information.

\\begin{figure}[h]
  \\centering
  \\includegraphics{image.png}
  \\caption{An example figure}
  \\label{fig:example}
\\end{figure}

\\section{Methods}
\\label{sec:methods}

\\subsection{Data Collection}

\\begin{table}[h]
  \\caption{Results table}
  \\label{tab:results}
  \\begin{tabular}{cc}
    A & B \\\\
    1 & 2
  \\end{tabular}
\\end{table}

\\section*{Acknowledgments}
Thanks to everyone.

\\end{document}
`);
        const { sections, environments, labels } = parseLatexDocument(doc);

        // Check sections
        expect(sections).toHaveLength(5);
        expect(sections.map(s => s.title)).toEqual([
            'Introduction',
            'Background',
            'Methods',
            'Data Collection',
            'Acknowledgments'
        ]);

        // Check starred section
        const ackSection = sections.find(s => s.title === 'Acknowledgments');
        expect(ackSection?.starred).toBe(true);

        // Check environments (figure, table, tabular)
        const envNames = environments.map(e => e.name);
        expect(envNames).toContain('figure');
        expect(envNames).toContain('table');
        expect(envNames).toContain('tabular');

        // Check labels
        expect(labels).toHaveLength(5);
        expect(labels.map(l => l.name)).toContain('sec:intro');
        expect(labels.map(l => l.name)).toContain('fig:example');
        expect(labels.map(l => l.name)).toContain('tab:results');

        // Check caption was captured
        const figEnv = environments.find(e => e.name === 'figure');
        expect(figEnv?.caption).toBe('An example figure');
        expect(figEnv?.label).toBe('fig:example');
    });

    it('should handle empty document', () => {
        const doc = createMockDocument('');
        const { sections, environments, labels } = parseLatexDocument(doc);

        expect(sections).toHaveLength(0);
        expect(environments).toHaveLength(0);
        expect(labels).toHaveLength(0);
    });

    it('should handle document with only preamble', () => {
        const doc = createMockDocument(`
\\documentclass{article}
\\usepackage{amsmath}
\\title{My Document}
\\author{Author Name}
`);
        const { sections, environments, labels } = parseLatexDocument(doc);

        expect(sections).toHaveLength(0);
        expect(environments).toHaveLength(0);
        expect(labels).toHaveLength(0);
    });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
    it('should handle sections with special characters in title', () => {
        const doc = createMockDocument(`
\\section{Introduction: A \\& B Analysis}
\\section{The $\\alpha$-Method}
`);
        const { sections } = parseLatexDocument(doc);

        expect(sections).toHaveLength(2);
        expect(sections[0].title).toBe('Introduction: A \\& B Analysis');
    });

    it('should handle multiple labels on same line', () => {
        const doc = createMockDocument(`
\\section{Test} \\label{sec:test}
`);
        const { labels } = parseLatexDocument(doc);

        expect(labels).toHaveLength(1);
        expect(labels[0].name).toBe('sec:test');
    });

    it('should handle environments without labels or captions', () => {
        const doc = createMockDocument(`
\\begin{center}
  Centered text
\\end{center}
`);
        const { environments } = parseLatexDocument(doc);

        expect(environments).toHaveLength(1);
        expect(environments[0].label).toBeUndefined();
        expect(environments[0].caption).toBeUndefined();
    });

    it('should handle indented section commands', () => {
        const doc = createMockDocument(`
  \\section{Indented Section}
`);
        const { sections } = parseLatexDocument(doc);

        expect(sections).toHaveLength(1);
        expect(sections[0].title).toBe('Indented Section');
    });
});
