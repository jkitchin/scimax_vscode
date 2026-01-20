/**
 * LaTeX Parser for manuscript flattening
 *
 * Parses LaTeX documents to extract:
 * - \input{} and \include{} commands
 * - \includegraphics commands
 * - Bibliography-related commands
 */

import {
  ParsedLatexDocument,
  InputCommand,
  FigureCommand,
  BibCommand,
  BibBackend,
} from './types';

/**
 * Verbatim-like environments where commands should not be parsed
 */
const VERBATIM_ENVIRONMENTS = [
  'verbatim',
  'lstlisting',
  'minted',
  'Verbatim',
  'alltt',
  'comment',
];

/**
 * Remove comments from LaTeX content while preserving positions
 * Returns content with comments replaced by spaces (to maintain positions)
 */
function removeComments(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    let processed = '';
    let i = 0;

    while (i < line.length) {
      // Check for escaped percent
      if (line[i] === '\\' && i + 1 < line.length && line[i + 1] === '%') {
        processed += '\\%';
        i += 2;
        continue;
      }

      // Comment starts here - replace rest with spaces
      if (line[i] === '%') {
        processed += ' '.repeat(line.length - i);
        break;
      }

      processed += line[i];
      i++;
    }

    result.push(processed);
  }

  return result.join('\n');
}

/**
 * Find ranges of verbatim environments to exclude from parsing
 */
function findVerbatimRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  for (const env of VERBATIM_ENVIRONMENTS) {
    const beginRegex = new RegExp(`\\\\begin\\{${env}\\}`, 'gi');
    const endRegex = new RegExp(`\\\\end\\{${env}\\}`, 'gi');

    let beginMatch;
    while ((beginMatch = beginRegex.exec(content)) !== null) {
      const start = beginMatch.index;

      // Find corresponding end
      endRegex.lastIndex = start;
      const endMatch = endRegex.exec(content);

      if (endMatch) {
        ranges.push({ start, end: endMatch.index + endMatch[0].length });
      }
    }
  }

  // Also handle \verb|...|
  const verbRegex = /\\verb(.)(.*?)\1/g;
  let verbMatch;
  while ((verbMatch = verbRegex.exec(content)) !== null) {
    ranges.push({ start: verbMatch.index, end: verbMatch.index + verbMatch[0].length });
  }

  return ranges;
}

/**
 * Check if a position is inside any verbatim range
 */
function isInVerbatim(position: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some(r => position >= r.start && position < r.end);
}

/**
 * Parse \input{} and \include{} commands
 */
function parseInputCommands(content: string, verbatimRanges: Array<{ start: number; end: number }>): InputCommand[] {
  const commands: InputCommand[] = [];

  // Match \input{path} or \include{path}
  // Also handle \input{path.tex} with explicit extension
  const regex = /\\(input|include)\{([^}]+)\}/g;

  let match;
  while ((match = regex.exec(content)) !== null) {
    if (isInVerbatim(match.index, verbatimRanges)) {
      continue;
    }

    commands.push({
      command: match[1] as 'input' | 'include',
      path: match[2].trim(),
      position: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  return commands;
}

/**
 * Parse \includegraphics commands
 */
function parseFigureCommands(content: string, verbatimRanges: Array<{ start: number; end: number }>): FigureCommand[] {
  const commands: FigureCommand[] = [];

  // Match \includegraphics[options]{path} or \includegraphics{path}
  const regex = /\\includegraphics(\[[^\]]*\])?\{([^}]+)\}/g;

  let match;
  while ((match = regex.exec(content)) !== null) {
    if (isInVerbatim(match.index, verbatimRanges)) {
      continue;
    }

    const path = match[2].trim();
    const options = match[1] ? match[1].slice(1, -1) : undefined; // Remove [ ]

    // Try to extract extension from path
    const extMatch = path.match(/\.([a-zA-Z]+)$/);
    const extension = extMatch ? `.${extMatch[1].toLowerCase()}` : undefined;

    commands.push({
      path,
      extension,
      options,
      position: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  return commands;
}

/**
 * Parse bibliography-related commands
 */
function parseBibCommands(content: string, verbatimRanges: Array<{ start: number; end: number }>): BibCommand[] {
  const commands: BibCommand[] = [];

  // \bibliography{refs} or \bibliography{refs1,refs2}
  const bibRegex = /\\bibliography\{([^}]+)\}/g;
  let match;
  while ((match = bibRegex.exec(content)) !== null) {
    if (isInVerbatim(match.index, verbatimRanges)) {
      continue;
    }
    commands.push({
      type: 'bibliography',
      bibFile: match[1].trim(),
      position: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // \addbibresource{refs.bib}
  const addBibRegex = /\\addbibresource\{([^}]+)\}/g;
  while ((match = addBibRegex.exec(content)) !== null) {
    if (isInVerbatim(match.index, verbatimRanges)) {
      continue;
    }
    commands.push({
      type: 'addbibresource',
      bibFile: match[1].trim(),
      position: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // \printbibliography (biblatex)
  const printBibRegex = /\\printbibliography(\[[^\]]*\])?/g;
  while ((match = printBibRegex.exec(content)) !== null) {
    if (isInVerbatim(match.index, verbatimRanges)) {
      continue;
    }
    commands.push({
      type: 'printbibliography',
      position: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  return commands;
}

/**
 * Parse a LaTeX document and extract relevant commands
 */
export function parseLatexDocument(content: string): ParsedLatexDocument {
  // First, neutralize comments (replace with spaces to preserve positions)
  const contentWithoutComments = removeComments(content);

  // Find verbatim ranges
  const verbatimRanges = findVerbatimRanges(contentWithoutComments);

  return {
    inputCommands: parseInputCommands(contentWithoutComments, verbatimRanges),
    figureCommands: parseFigureCommands(contentWithoutComments, verbatimRanges),
    bibliographyCommands: parseBibCommands(contentWithoutComments, verbatimRanges),
    content,
  };
}

/**
 * Detect which bibliography backend the document uses
 */
export function detectBibBackend(content: string): BibBackend {
  // Check for biblatex package
  const biblatexMatch = content.match(/\\usepackage(\[[^\]]*\])?\{biblatex\}/);

  if (biblatexMatch) {
    // Check if backend=bibtex is explicitly specified
    if (biblatexMatch[1] && /backend\s*=\s*bibtex/.test(biblatexMatch[1])) {
      return 'bibtex';
    }
    // biblatex defaults to biber
    return 'biber';
  }

  // Check for natbib (uses bibtex)
  if (/\\usepackage(\[[^\]]*\])?\{natbib\}/.test(content)) {
    return 'bibtex';
  }

  // Traditional \bibliography{} command implies bibtex
  if (/\\bibliography\{/.test(content)) {
    return 'bibtex';
  }

  // Default to bibtex as it's more common
  return 'bibtex';
}

/**
 * Extract bibliography file paths from document
 */
export function extractBibFiles(content: string): string[] {
  const bibFiles: string[] = [];

  // \bibliography{refs} or \bibliography{refs1,refs2}
  const bibMatch = content.match(/\\bibliography\{([^}]+)\}/);
  if (bibMatch) {
    // Split by comma for multiple bib files
    const files = bibMatch[1].split(',').map(f => f.trim());
    bibFiles.push(...files);
  }

  // \addbibresource{refs.bib}
  const addBibRegex = /\\addbibresource\{([^}]+)\}/g;
  let match;
  while ((match = addBibRegex.exec(content)) !== null) {
    bibFiles.push(match[1].trim());
  }

  return bibFiles;
}

/**
 * Check if a document uses biblatex (vs traditional bibtex)
 */
export function usesBiblatex(content: string): boolean {
  return /\\usepackage(\[[^\]]*\])?\{biblatex\}/.test(content);
}
