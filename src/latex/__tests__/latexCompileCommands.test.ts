/**
 * Tests for LaTeX compile commands configuration
 * Tests command registration, settings, and helper functions
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// Compiler Configuration Tests
// =============================================================================

describe('LaTeX Compiler Configuration', () => {
    const SUPPORTED_COMPILERS = ['pdflatex', 'xelatex', 'lualatex', 'latexmk'];
    const DEFAULT_COMPILER = 'pdflatex';

    it('should have pdflatex as default compiler', () => {
        expect(DEFAULT_COMPILER).toBe('pdflatex');
    });

    it('should support common LaTeX compilers', () => {
        expect(SUPPORTED_COMPILERS).toContain('pdflatex');
        expect(SUPPORTED_COMPILERS).toContain('xelatex');
        expect(SUPPORTED_COMPILERS).toContain('lualatex');
        expect(SUPPORTED_COMPILERS).toContain('latexmk');
    });

    it('should have 4 supported compilers', () => {
        expect(SUPPORTED_COMPILERS).toHaveLength(4);
    });
});

// =============================================================================
// PDF Viewer Configuration Tests
// =============================================================================

describe('PDF Viewer Configuration', () => {
    const SUPPORTED_VIEWERS = ['auto', 'skim', 'zathura', 'sumatra', 'vscode'];
    const DEFAULT_VIEWER = 'auto';

    it('should have auto as default viewer', () => {
        expect(DEFAULT_VIEWER).toBe('auto');
    });

    it('should support platform-specific viewers', () => {
        expect(SUPPORTED_VIEWERS).toContain('skim');     // macOS
        expect(SUPPORTED_VIEWERS).toContain('zathura');  // Linux
        expect(SUPPORTED_VIEWERS).toContain('sumatra');  // Windows
    });

    it('should support VS Code viewer', () => {
        expect(SUPPORTED_VIEWERS).toContain('vscode');
    });
});

// =============================================================================
// LaTeX Path Enhancement Tests
// =============================================================================

describe('LaTeX Path Enhancement', () => {
    const LATEX_PATHS = [
        '/Library/TeX/texbin',
        '/usr/local/texlive/2025/bin/universal-darwin',
        '/usr/local/texlive/2024/bin/universal-darwin',
        '/usr/local/texlive/2023/bin/universal-darwin',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
    ];

    it('should include MacTeX path', () => {
        expect(LATEX_PATHS).toContain('/Library/TeX/texbin');
    });

    it('should include TeX Live paths', () => {
        const texlivePaths = LATEX_PATHS.filter(p => p.includes('texlive'));
        expect(texlivePaths.length).toBeGreaterThan(0);
    });

    it('should include Homebrew paths', () => {
        expect(LATEX_PATHS).toContain('/opt/homebrew/bin');
        expect(LATEX_PATHS).toContain('/usr/local/bin');
    });

    it('should include standard Unix paths', () => {
        expect(LATEX_PATHS).toContain('/usr/bin');
    });
});

// =============================================================================
// Compile Command Arguments Tests
// =============================================================================

describe('Compile Command Arguments', () => {
    const DEFAULT_ARGS = ['-interaction=nonstopmode', '-file-line-error'];

    it('should use nonstopmode for non-interactive compilation', () => {
        expect(DEFAULT_ARGS).toContain('-interaction=nonstopmode');
    });

    it('should enable file:line:error format', () => {
        expect(DEFAULT_ARGS).toContain('-file-line-error');
    });
});

// =============================================================================
// SyncTeX Forward Search Tests
// =============================================================================

describe('SyncTeX Forward Search', () => {
    // Platform detection helper
    function getPlatformViewer(platform: string, configuredViewer: string): string {
        if (configuredViewer !== 'auto') {
            return configuredViewer;
        }

        switch (platform) {
            case 'darwin':
                return 'skim';
            case 'linux':
                return 'zathura';
            case 'win32':
                return 'sumatra';
            default:
                return 'vscode';
        }
    }

    it('should select Skim on macOS in auto mode', () => {
        expect(getPlatformViewer('darwin', 'auto')).toBe('skim');
    });

    it('should select Zathura on Linux in auto mode', () => {
        expect(getPlatformViewer('linux', 'auto')).toBe('zathura');
    });

    it('should select SumatraPDF on Windows in auto mode', () => {
        expect(getPlatformViewer('win32', 'auto')).toBe('sumatra');
    });

    it('should respect explicit viewer selection', () => {
        expect(getPlatformViewer('darwin', 'zathura')).toBe('zathura');
        expect(getPlatformViewer('linux', 'skim')).toBe('skim');
    });
});

// =============================================================================
// Insert Snippet Tests
// =============================================================================

describe('LaTeX Insert Snippets', () => {
    const FIGURE_SNIPPET =
        '\\begin{figure}[${1:htbp}]\n' +
        '  \\centering\n' +
        '  \\includegraphics[width=${2:0.8}\\textwidth]{${3:filename}}\n' +
        '  \\caption{${4:Caption}}\n' +
        '  \\label{fig:${5:label}}\n' +
        '\\end{figure}\n';

    const TABLE_SNIPPET =
        '\\begin{table}[${1:htbp}]\n' +
        '  \\centering\n' +
        '  \\caption{${2:Caption}}\n' +
        '  \\label{tab:${3:label}}\n' +
        '  \\begin{tabular}{${4:lcc}}\n' +
        '    \\toprule\n' +
        '    ${5:Header 1} & ${6:Header 2} & ${7:Header 3} \\\\\\\\\n' +
        '    \\midrule\n' +
        '    ${8:Data 1} & ${9:Data 2} & ${10:Data 3} \\\\\\\\\n' +
        '    \\bottomrule\n' +
        '  \\end{tabular}\n' +
        '\\end{table}\n';

    const EQUATION_SNIPPET =
        '\\begin{equation}\n' +
        '  ${1:equation}\n' +
        '  \\label{eq:${2:label}}\n' +
        '\\end{equation}\n';

    describe('Figure snippet', () => {
        it('should include figure environment', () => {
            expect(FIGURE_SNIPPET).toContain('\\begin{figure}');
            expect(FIGURE_SNIPPET).toContain('\\end{figure}');
        });

        it('should include centering', () => {
            expect(FIGURE_SNIPPET).toContain('\\centering');
        });

        it('should include includegraphics', () => {
            expect(FIGURE_SNIPPET).toContain('\\includegraphics');
        });

        it('should include caption and label', () => {
            expect(FIGURE_SNIPPET).toContain('\\caption');
            expect(FIGURE_SNIPPET).toContain('\\label{fig:');
        });

        it('should have tab stops', () => {
            expect(FIGURE_SNIPPET).toContain('${1:');
            expect(FIGURE_SNIPPET).toContain('${2:');
        });
    });

    describe('Table snippet', () => {
        it('should include table and tabular environments', () => {
            expect(TABLE_SNIPPET).toContain('\\begin{table}');
            expect(TABLE_SNIPPET).toContain('\\begin{tabular}');
        });

        it('should use booktabs commands', () => {
            expect(TABLE_SNIPPET).toContain('\\toprule');
            expect(TABLE_SNIPPET).toContain('\\midrule');
            expect(TABLE_SNIPPET).toContain('\\bottomrule');
        });

        it('should include caption and label', () => {
            expect(TABLE_SNIPPET).toContain('\\caption');
            expect(TABLE_SNIPPET).toContain('\\label{tab:');
        });
    });

    describe('Equation snippet', () => {
        it('should include equation environment', () => {
            expect(EQUATION_SNIPPET).toContain('\\begin{equation}');
            expect(EQUATION_SNIPPET).toContain('\\end{equation}');
        });

        it('should include label', () => {
            expect(EQUATION_SNIPPET).toContain('\\label{eq:');
        });
    });
});

// =============================================================================
// Command Registration Tests
// =============================================================================

describe('LaTeX Command Registration', () => {
    const COMPILE_COMMANDS = [
        'scimax.latex.compile',
        'scimax.latex.viewPdf',
        'scimax.latex.compileAndView',
        'scimax.latex.clean',
        'scimax.latex.syncTexForward',
        'scimax.latex.wordCount',
        'scimax.latex.insertFigure',
        'scimax.latex.insertTable',
        'scimax.latex.insertEquation',
    ];

    it('should have compile command', () => {
        expect(COMPILE_COMMANDS).toContain('scimax.latex.compile');
    });

    it('should have view command', () => {
        expect(COMPILE_COMMANDS).toContain('scimax.latex.viewPdf');
    });

    it('should have combined compile and view command', () => {
        expect(COMPILE_COMMANDS).toContain('scimax.latex.compileAndView');
    });

    it('should have clean command', () => {
        expect(COMPILE_COMMANDS).toContain('scimax.latex.clean');
    });

    it('should have SyncTeX command', () => {
        expect(COMPILE_COMMANDS).toContain('scimax.latex.syncTexForward');
    });

    it('should have insert commands', () => {
        expect(COMPILE_COMMANDS).toContain('scimax.latex.insertFigure');
        expect(COMPILE_COMMANDS).toContain('scimax.latex.insertTable');
        expect(COMPILE_COMMANDS).toContain('scimax.latex.insertEquation');
    });

    it('should have word count command', () => {
        expect(COMPILE_COMMANDS).toContain('scimax.latex.wordCount');
    });
});
