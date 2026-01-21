/**
 * Type definitions for the LaTeX manuscript flattening module
 */

/**
 * Position of a command in the source text
 */
export interface TextPosition {
  start: number;
  end: number;
}

/**
 * An \input{} or \include{} command
 */
export interface InputCommand {
  command: 'input' | 'include';
  path: string;
  position: TextPosition;
  /** The file this command was found in */
  sourceFile?: string;
}

/**
 * An \includegraphics command
 */
export interface FigureCommand {
  /** The path as written in the LaTeX source */
  path: string;
  /** Resolved absolute path to the actual file */
  resolvedPath?: string;
  /** File extension (may be auto-detected if omitted in source) */
  extension?: string;
  /** Optional arguments like [width=\textwidth] */
  options?: string;
  position: TextPosition;
}

/**
 * A bibliography-related command
 */
export interface BibCommand {
  /** The type of command */
  type: 'bibliography' | 'addbibresource' | 'printbibliography';
  /** The .bib file path (for bibliography/addbibresource) */
  bibFile?: string;
  position: TextPosition;
}

/**
 * Result of parsing a LaTeX document
 */
export interface ParsedLatexDocument {
  /** All \input and \include commands */
  inputCommands: InputCommand[];
  /** All \includegraphics commands */
  figureCommands: FigureCommand[];
  /** All bibliography-related commands */
  bibliographyCommands: BibCommand[];
  /** The raw content */
  content: string;
}

/**
 * Mapping from original figure path to new sequential name
 */
export interface FigureMapping {
  /** Original path as written in LaTeX source */
  originalPath: string;
  /** New sequential name (e.g., "01.pdf") */
  newName: string;
  /** Full resolved path to the source file */
  resolvedSource: string;
  /** File extension */
  extension: string;
}

/**
 * Result of processing figures
 */
export interface ProcessedFigures {
  /** Mappings from original to new names */
  mappings: FigureMapping[];
  /** Content with updated figure paths */
  updatedContent: string;
}

/**
 * Options for LaTeX compilation
 */
export interface CompileOptions {
  /** Working directory for compilation */
  workingDir: string;
  /** Main .tex file name */
  texFile: string;
  /** Which bibliography backend to use */
  bibtexBackend?: 'bibtex' | 'biber' | 'auto';
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Result of LaTeX compilation
 */
export interface CompileResult {
  /** Whether compilation succeeded */
  success: boolean;
  /** Whether .bbl file was generated */
  bblGenerated: boolean;
  /** Path to the generated .bbl file */
  bblPath?: string;
  /** Combined stdout/stderr log */
  log: string;
  /** Error messages */
  errors: string[];
}

/**
 * Result of finding and reading a .bbl file
 */
export interface BblResult {
  /** The .bbl file content */
  content: string;
  /** Whether the file was found */
  found: boolean;
  /** Path to the .bbl file */
  bblPath?: string;
}

/**
 * Options for flattening a manuscript
 */
export interface FlattenOptions {
  /** Output directory (if not specified, auto-generated with datestamp) */
  outputDir?: string;
  /** Whether to compile first to generate .bbl */
  compile?: boolean | 'if-needed';
  /** Bibliography backend to use */
  bibtexBackend?: 'bibtex' | 'biber' | 'auto';
  /** Maximum depth for nested \input resolution */
  maxDepth?: number;
  /** Timeout for compilation in milliseconds */
  compileTimeout?: number;
}

/**
 * Result of flattening a manuscript
 */
export interface FlattenResult {
  /** Path to the output directory */
  outputDir: string;
  /** Path to the flattened .tex file */
  outputTexPath: string;
  /** Figure mappings that were applied */
  figuresCopied: FigureMapping[];
  /** Support files copied (.sty, .cls, .bst, etc.) */
  supportFilesCopied: string[];
  /** Whether .bbl was successfully inlined */
  bblInlined: boolean;
  /** Warning messages */
  warnings: string[];
  /** Whether compilation was run */
  compilationRun: boolean;
}

/**
 * Detected bibliography backend
 */
export type BibBackend = 'bibtex' | 'biber';
