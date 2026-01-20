/**
 * LaTeX Manuscript Flattening Module
 *
 * Provides tools for preparing LaTeX manuscripts for journal submission:
 * - Flatten \input and \include commands
 * - Inline .bbl bibliography content
 * - Rename figures sequentially
 * - Copy all files to a timestamped submission directory
 */

export * from './types';
export * from './latexParser';
export * from './latexCompiler';
export * from './fileFlattener';
export * from './bibliographyHandler';
export * from './figureProcessor';
export * from './manuscriptManager';
export { registerManuscriptCommands } from './commands';
