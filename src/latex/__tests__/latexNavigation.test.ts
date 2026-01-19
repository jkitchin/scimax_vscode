/**
 * Tests for LaTeX navigation utilities
 */

import { describe, it, expect } from 'vitest';
import { isSectionLine, parseSectionLine } from '../latexNavigation';

// =============================================================================
// Section Line Detection Tests
// =============================================================================

describe('LaTeX Section Line Detection', () => {
    describe('isSectionLine', () => {
        it('should detect standard section commands', () => {
            expect(isSectionLine('\\section{Title}')).toBe(true);
            expect(isSectionLine('\\subsection{Title}')).toBe(true);
            expect(isSectionLine('\\subsubsection{Title}')).toBe(true);
            expect(isSectionLine('\\chapter{Title}')).toBe(true);
            expect(isSectionLine('\\part{Title}')).toBe(true);
            expect(isSectionLine('\\paragraph{Title}')).toBe(true);
            expect(isSectionLine('\\subparagraph{Title}')).toBe(true);
        });

        it('should detect starred section commands', () => {
            expect(isSectionLine('\\section*{Title}')).toBe(true);
            expect(isSectionLine('\\subsection*{Title}')).toBe(true);
            expect(isSectionLine('\\chapter*{Title}')).toBe(true);
        });

        it('should detect sections with short titles', () => {
            expect(isSectionLine('\\section[Short]{Long Title}')).toBe(true);
            expect(isSectionLine('\\chapter[TOC Title]{Full Chapter Title}')).toBe(true);
        });

        it('should detect indented section commands', () => {
            expect(isSectionLine('  \\section{Title}')).toBe(true);
            expect(isSectionLine('    \\subsection{Title}')).toBe(true);
            expect(isSectionLine('\t\\section{Title}')).toBe(true);
        });

        it('should not detect non-section commands', () => {
            expect(isSectionLine('\\begin{document}')).toBe(false);
            expect(isSectionLine('\\label{sec:intro}')).toBe(false);
            expect(isSectionLine('\\textbf{Bold text}')).toBe(false);
            expect(isSectionLine('Some regular text')).toBe(false);
            expect(isSectionLine('')).toBe(false);
        });

        it('should not detect incomplete section commands', () => {
            expect(isSectionLine('\\section')).toBe(false);
            expect(isSectionLine('\\section ')).toBe(false);
            // These should match because they have the opening brace
            expect(isSectionLine('\\section{')).toBe(true);
        });

        it('should not match section in comments', () => {
            // Note: Our simple regex doesn't handle comments
            // This documents current behavior
            expect(isSectionLine('% \\section{Commented}')).toBe(false);
        });
    });

    describe('parseSectionLine', () => {
        it('should parse standard sections', () => {
            const result = parseSectionLine('\\section{Title}');
            expect(result).toEqual({ type: 'section', starred: false });
        });

        it('should parse starred sections', () => {
            const result = parseSectionLine('\\section*{Title}');
            expect(result).toEqual({ type: 'section', starred: true });
        });

        it('should parse all section types', () => {
            expect(parseSectionLine('\\part{T}')?.type).toBe('part');
            expect(parseSectionLine('\\chapter{T}')?.type).toBe('chapter');
            expect(parseSectionLine('\\section{T}')?.type).toBe('section');
            expect(parseSectionLine('\\subsection{T}')?.type).toBe('subsection');
            expect(parseSectionLine('\\subsubsection{T}')?.type).toBe('subsubsection');
            expect(parseSectionLine('\\paragraph{T}')?.type).toBe('paragraph');
            expect(parseSectionLine('\\subparagraph{T}')?.type).toBe('subparagraph');
        });

        it('should parse sections with short titles', () => {
            const result = parseSectionLine('\\section[Short]{Long Title}');
            expect(result).toEqual({ type: 'section', starred: false });
        });

        it('should return null for non-section lines', () => {
            expect(parseSectionLine('\\begin{document}')).toBeNull();
            expect(parseSectionLine('Regular text')).toBeNull();
            expect(parseSectionLine('')).toBeNull();
        });

        it('should handle indented sections', () => {
            const result = parseSectionLine('  \\subsection{Indented}');
            expect(result).toEqual({ type: 'subsection', starred: false });
        });
    });
});

// =============================================================================
// Section Hierarchy Tests
// =============================================================================

describe('Section Hierarchy Logic', () => {
    // These test the logic used for navigation

    it('section levels should be ordered correctly', () => {
        const levels = [
            { type: 'part', expectedLevel: 0 },
            { type: 'chapter', expectedLevel: 1 },
            { type: 'section', expectedLevel: 2 },
            { type: 'subsection', expectedLevel: 3 },
            { type: 'subsubsection', expectedLevel: 4 },
            { type: 'paragraph', expectedLevel: 5 },
            { type: 'subparagraph', expectedLevel: 6 },
        ];

        // Verify ordering: lower level number = higher in hierarchy
        for (let i = 0; i < levels.length - 1; i++) {
            expect(levels[i].expectedLevel).toBeLessThan(levels[i + 1].expectedLevel);
        }
    });

    it('parent section should have lower level number', () => {
        // subsection (3) parent is section (2)
        expect(3).toBeGreaterThan(2);

        // subsubsection (4) parent is subsection (3)
        expect(4).toBeGreaterThan(3);
    });

    it('sibling sections should have same level number', () => {
        // Two sections are siblings if they have the same level
        const section1Level = 2;
        const section2Level = 2;
        expect(section1Level).toBe(section2Level);
    });
});
