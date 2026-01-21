/**
 * Unit tests for the LaTeX manuscript flattening module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

import {
  parseLatexDocument,
  detectBibBackend,
  extractBibFiles,
  usesBiblatex,
} from '../latexParser';
import { flattenIncludes } from '../fileFlattener';
import { replaceBibliographyWithBbl } from '../bibliographyHandler';
import { processFigures } from '../figureProcessor';

describe('LaTeX Parser', () => {
  describe('parseLatexDocument', () => {
    it('should parse \\input commands', () => {
      const content = `
\\documentclass{article}
\\begin{document}
\\input{intro}
\\input{methods.tex}
\\end{document}
`;
      const result = parseLatexDocument(content);

      expect(result.inputCommands).toHaveLength(2);
      expect(result.inputCommands[0].command).toBe('input');
      expect(result.inputCommands[0].path).toBe('intro');
      expect(result.inputCommands[1].path).toBe('methods.tex');
    });

    it('should parse \\include commands', () => {
      const content = `
\\documentclass{article}
\\begin{document}
\\include{chapter1}
\\include{chapter2}
\\end{document}
`;
      const result = parseLatexDocument(content);

      expect(result.inputCommands).toHaveLength(2);
      expect(result.inputCommands[0].command).toBe('include');
      expect(result.inputCommands[1].command).toBe('include');
    });

    it('should parse \\includegraphics commands', () => {
      const content = `
\\begin{figure}
\\includegraphics{figures/plot1.pdf}
\\includegraphics[width=0.8\\textwidth]{images/diagram.png}
\\end{figure}
`;
      const result = parseLatexDocument(content);

      expect(result.figureCommands).toHaveLength(2);
      expect(result.figureCommands[0].path).toBe('figures/plot1.pdf');
      expect(result.figureCommands[0].extension).toBe('.pdf');
      expect(result.figureCommands[1].path).toBe('images/diagram.png');
      expect(result.figureCommands[1].options).toBe('width=0.8\\textwidth');
    });

    it('should parse \\includegraphics without extension', () => {
      const content = `\\includegraphics{myplot}`;
      const result = parseLatexDocument(content);

      expect(result.figureCommands).toHaveLength(1);
      expect(result.figureCommands[0].path).toBe('myplot');
      expect(result.figureCommands[0].extension).toBeUndefined();
    });

    it('should parse \\bibliography command', () => {
      const content = `
\\bibliographystyle{plain}
\\bibliography{refs}
`;
      const result = parseLatexDocument(content);

      expect(result.bibliographyCommands).toHaveLength(1);
      expect(result.bibliographyCommands[0].type).toBe('bibliography');
      expect(result.bibliographyCommands[0].bibFile).toBe('refs');
    });

    it('should parse biblatex commands', () => {
      const content = `
\\usepackage{biblatex}
\\addbibresource{references.bib}
\\begin{document}
\\printbibliography
\\end{document}
`;
      const result = parseLatexDocument(content);

      expect(result.bibliographyCommands).toHaveLength(2);
      expect(result.bibliographyCommands[0].type).toBe('addbibresource');
      expect(result.bibliographyCommands[0].bibFile).toBe('references.bib');
      expect(result.bibliographyCommands[1].type).toBe('printbibliography');
    });

    it('should ignore commands in comments', () => {
      const content = `
\\documentclass{article}
% \\input{commented-out}
\\input{real-file}
% \\includegraphics{commented-image}
`;
      const result = parseLatexDocument(content);

      expect(result.inputCommands).toHaveLength(1);
      expect(result.inputCommands[0].path).toBe('real-file');
      expect(result.figureCommands).toHaveLength(0);
    });

    it('should ignore commands in verbatim environment', () => {
      const content = `
\\begin{verbatim}
\\input{verbatim-input}
\\includegraphics{verbatim-image}
\\end{verbatim}
\\input{real-input}
`;
      const result = parseLatexDocument(content);

      expect(result.inputCommands).toHaveLength(1);
      expect(result.inputCommands[0].path).toBe('real-input');
    });
  });

  describe('detectBibBackend', () => {
    it('should detect bibtex for traditional bibliography', () => {
      const content = `
\\documentclass{article}
\\bibliography{refs}
`;
      expect(detectBibBackend(content)).toBe('bibtex');
    });

    it('should detect biber for biblatex (default)', () => {
      const content = `
\\documentclass{article}
\\usepackage{biblatex}
`;
      expect(detectBibBackend(content)).toBe('biber');
    });

    it('should detect bibtex for biblatex with backend=bibtex', () => {
      const content = `
\\documentclass{article}
\\usepackage[backend=bibtex]{biblatex}
`;
      expect(detectBibBackend(content)).toBe('bibtex');
    });

    it('should detect bibtex for natbib', () => {
      const content = `
\\documentclass{article}
\\usepackage{natbib}
`;
      expect(detectBibBackend(content)).toBe('bibtex');
    });
  });

  describe('extractBibFiles', () => {
    it('should extract single bib file', () => {
      const content = `\\bibliography{refs}`;
      expect(extractBibFiles(content)).toEqual(['refs']);
    });

    it('should extract multiple bib files', () => {
      const content = `\\bibliography{refs1,refs2,refs3}`;
      expect(extractBibFiles(content)).toEqual(['refs1', 'refs2', 'refs3']);
    });

    it('should extract biblatex addbibresource', () => {
      const content = `
\\addbibresource{main.bib}
\\addbibresource{extra.bib}
`;
      expect(extractBibFiles(content)).toEqual(['main.bib', 'extra.bib']);
    });
  });

  describe('usesBiblatex', () => {
    it('should return true for biblatex', () => {
      expect(usesBiblatex('\\usepackage{biblatex}')).toBe(true);
      expect(usesBiblatex('\\usepackage[style=apa]{biblatex}')).toBe(true);
    });

    it('should return false for traditional bibtex', () => {
      expect(usesBiblatex('\\bibliography{refs}')).toBe(false);
      expect(usesBiblatex('\\usepackage{natbib}')).toBe(false);
    });
  });
});

describe('Bibliography Handler', () => {
  describe('replaceBibliographyWithBbl', () => {
    it('should replace \\bibliography with bbl content', () => {
      const content = `
\\documentclass{article}
\\begin{document}
Some text.
\\bibliography{refs}
\\end{document}
`;
      const bblContent = `\\begin{thebibliography}{1}
\\bibitem{key1} Author. Title. Year.
\\end{thebibliography}`;

      const result = replaceBibliographyWithBbl(content, bblContent);

      expect(result.replaced).toBe(true);
      expect(result.content).toContain('\\begin{thebibliography}');
      expect(result.content).not.toContain('\\bibliography{refs}');
    });

    it('should replace \\printbibliography for biblatex', () => {
      const content = `
\\documentclass{article}
\\usepackage{biblatex}
\\addbibresource{refs.bib}
\\begin{document}
Some text.
\\printbibliography
\\end{document}
`;
      const bblContent = `% biblatex generated content`;

      const result = replaceBibliographyWithBbl(content, bblContent);

      expect(result.replaced).toBe(true);
      expect(result.content).toContain('% biblatex generated content');
      expect(result.content).not.toContain('\\printbibliography');
      // addbibresource should be commented out
      expect(result.content).toContain('% \\addbibresource{refs.bib}');
    });
  });
});

describe('Figure Processor', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuscript-test-'));

    // Create test figure files
    await fs.writeFile(path.join(tempDir, 'plot1.pdf'), 'fake pdf');
    await fs.writeFile(path.join(tempDir, 'plot2.png'), 'fake png');
    await fs.mkdir(path.join(tempDir, 'figures'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'figures', 'diagram.pdf'), 'fake pdf');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should process and rename figures', async () => {
    const content = `
\\begin{figure}
\\includegraphics{plot1.pdf}
\\end{figure}
\\begin{figure}
\\includegraphics{plot2.png}
\\end{figure}
`;
    const result = await processFigures(content, tempDir);

    expect(result.mappings).toHaveLength(2);
    expect(result.mappings[0].newName).toBe('1.pdf');
    expect(result.mappings[1].newName).toBe('2.png');
    expect(result.updatedContent).toContain('\\includegraphics{1.pdf}');
    expect(result.updatedContent).toContain('\\includegraphics{2.png}');
  });

  it('should handle figures in subdirectories', async () => {
    const content = `\\includegraphics{figures/diagram.pdf}`;
    const result = await processFigures(content, tempDir);

    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].originalPath).toBe('figures/diagram.pdf');
    expect(result.mappings[0].newName).toBe('1.pdf');
  });

  it('should preserve includegraphics options', async () => {
    const content = `\\includegraphics[width=0.8\\textwidth]{plot1.pdf}`;
    const result = await processFigures(content, tempDir);

    expect(result.updatedContent).toContain('[width=0.8\\textwidth]');
    expect(result.updatedContent).toContain('{1.pdf}');
  });

  it('should pad figure numbers appropriately', async () => {
    // Create 10 more figure files to test padding
    for (let i = 3; i <= 12; i++) {
      await fs.writeFile(path.join(tempDir, `fig${i}.pdf`), 'fake pdf');
    }

    let content = '';
    for (let i = 1; i <= 12; i++) {
      if (i <= 2) {
        content += `\\includegraphics{plot${i}.${i === 1 ? 'pdf' : 'png'}}\n`;
      } else {
        content += `\\includegraphics{fig${i}.pdf}\n`;
      }
    }

    const result = await processFigures(content, tempDir);

    // With 12 figures, should use 2-digit padding
    expect(result.mappings[0].newName).toBe('01.pdf');
    expect(result.mappings[9].newName).toBe('10.pdf');
    expect(result.mappings[11].newName).toBe('12.pdf');
  });

  it('should warn about missing figures', async () => {
    const content = `\\includegraphics{nonexistent.pdf}`;
    const result = await processFigures(content, tempDir);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nonexistent.pdf');
  });

  it('should handle figures without extension', async () => {
    const content = `\\includegraphics{plot1}`;
    const result = await processFigures(content, tempDir);

    // Should find plot1.pdf
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].extension).toBe('.pdf');
  });

  it('should deduplicate same figure used multiple times', async () => {
    const content = `
\\includegraphics{plot1.pdf}
\\includegraphics{plot1.pdf}
`;
    const result = await processFigures(content, tempDir);

    // Should only have one mapping
    expect(result.mappings).toHaveLength(1);
    // But both should be renamed in content
    expect((result.updatedContent.match(/1\.pdf/g) || []).length).toBe(2);
  });
});

describe('File Flattener', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuscript-flatten-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should flatten \\input commands', async () => {
    // Create main file
    await fs.writeFile(
      path.join(tempDir, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\n\\input{section1}\n\\end{document}'
    );

    // Create included file
    await fs.writeFile(
      path.join(tempDir, 'section1.tex'),
      'This is section 1 content.'
    );

    const content = await fs.readFile(path.join(tempDir, 'main.tex'), 'utf-8');
    const result = await flattenIncludes(content, path.join(tempDir, 'main.tex'), {
      rootDir: tempDir,
    });

    expect(result.content).toContain('This is section 1 content.');
    expect(result.content).not.toContain('\\input{section1}');
    expect(result.includedFiles).toHaveLength(1);
  });

  it('should handle nested includes', async () => {
    await fs.writeFile(
      path.join(tempDir, 'main.tex'),
      '\\input{level1}'
    );
    await fs.writeFile(
      path.join(tempDir, 'level1.tex'),
      'Level 1 start\n\\input{level2}\nLevel 1 end'
    );
    await fs.writeFile(
      path.join(tempDir, 'level2.tex'),
      'Level 2 content'
    );

    const content = await fs.readFile(path.join(tempDir, 'main.tex'), 'utf-8');
    const result = await flattenIncludes(content, path.join(tempDir, 'main.tex'), {
      rootDir: tempDir,
    });

    expect(result.content).toContain('Level 1 start');
    expect(result.content).toContain('Level 2 content');
    expect(result.content).toContain('Level 1 end');
    expect(result.includedFiles).toHaveLength(2);
  });

  it('should add \\clearpage for \\include', async () => {
    await fs.writeFile(
      path.join(tempDir, 'main.tex'),
      '\\include{chapter}'
    );
    await fs.writeFile(
      path.join(tempDir, 'chapter.tex'),
      'Chapter content'
    );

    const content = await fs.readFile(path.join(tempDir, 'main.tex'), 'utf-8');
    const result = await flattenIncludes(content, path.join(tempDir, 'main.tex'), {
      rootDir: tempDir,
    });

    expect(result.content).toContain('\\clearpage');
    expect(result.content).toContain('Chapter content');
  });

  it('should detect circular includes', async () => {
    await fs.writeFile(
      path.join(tempDir, 'a.tex'),
      '\\input{b}'
    );
    await fs.writeFile(
      path.join(tempDir, 'b.tex'),
      '\\input{a}'
    );

    const content = await fs.readFile(path.join(tempDir, 'a.tex'), 'utf-8');
    const result = await flattenIncludes(content, path.join(tempDir, 'a.tex'), {
      rootDir: tempDir,
    });

    expect(result.warnings.some(w => w.includes('Circular'))).toBe(true);
  });

  it('should warn about missing files', async () => {
    await fs.writeFile(
      path.join(tempDir, 'main.tex'),
      '\\input{nonexistent}'
    );

    const content = await fs.readFile(path.join(tempDir, 'main.tex'), 'utf-8');
    const result = await flattenIncludes(content, path.join(tempDir, 'main.tex'), {
      rootDir: tempDir,
    });

    expect(result.warnings.some(w => w.includes('nonexistent'))).toBe(true);
  });

  it('should respect maxDepth limit', async () => {
    // Create deeply nested includes
    for (let i = 1; i <= 25; i++) {
      const next = i < 25 ? `\\input{level${i + 1}}` : 'End';
      await fs.writeFile(
        path.join(tempDir, `level${i}.tex`),
        `Level ${i}\n${next}`
      );
    }

    const content = '\\input{level1}';
    const result = await flattenIncludes(content, path.join(tempDir, 'main.tex'), {
      rootDir: tempDir,
      maxDepth: 5,
    });

    expect(result.warnings.some(w => w.includes('Maximum include depth'))).toBe(true);
  });
});
