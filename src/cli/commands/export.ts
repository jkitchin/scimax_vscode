/**
 * Export command - convert org files to HTML, PDF, LaTeX
 *
 * Uses the same settings as the VS Code extension for consistent behavior.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseOrgFast } from '../../parser/orgExportParser';
import { exportToHtml } from '../../parser/orgExportHtml';
import { exportToLatex } from '../../parser/orgExportLatex';
import { parseBibTeX } from '../../references/bibtexParser';
import { loadSettings, expandPath, ExportSettings, RefSettings } from '../settings';

interface CliConfig {
    dbPath: string;
    rootDir: string;
}

interface ParsedArgs {
    command: string;
    subcommand?: string;
    args: string[];
    flags: Record<string, string | boolean>;
}

/**
 * Parse class options from comma-separated string to array
 */
function parseClassOptions(classOptions: string): string[] {
    if (!classOptions) return [];
    return classOptions.split(',').map(s => s.trim()).filter(s => s);
}

export async function exportCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const inputFile = args.args[0];

    if (!inputFile) {
        console.error('Usage: scimax export <file.org> [--format html|latex|pdf] [--output path]');
        process.exit(1);
    }

    // Load settings from VS Code settings.json
    const settings = loadSettings();

    const format = (typeof args.flags.format === 'string' ? args.flags.format : 'html').toLowerCase();
    const outputPath = typeof args.flags.output === 'string' ? args.flags.output : undefined;

    // Read input file
    const inputPath = path.resolve(inputFile);
    if (!fs.existsSync(inputPath)) {
        console.error(`File not found: ${inputPath}`);
        process.exit(1);
    }

    const content = fs.readFileSync(inputPath, 'utf-8');
    const doc = parseOrgFast(content);

    // Look for bibliography file (check settings first, then local files)
    let bibEntries;
    const bibFile = typeof args.flags.bib === 'string'
        ? args.flags.bib
        : findBibFile(inputPath, settings.ref);
    if (bibFile && fs.existsSync(bibFile)) {
        console.log(`Using bibliography: ${bibFile}`);
        const bibContent = fs.readFileSync(bibFile, 'utf-8');
        const parseResult = parseBibTeX(bibContent);
        bibEntries = parseResult.entries;
    }

    // CSL style
    const cslStyle = typeof args.flags.csl === 'string' ? args.flags.csl : 'apa';

    let output: string;
    let defaultExt: string;

    switch (format) {
        case 'html':
            output = exportToHtml(doc, {
                bibEntries,
                citationStyle: cslStyle,
                bibliography: true,
            });
            defaultExt = '.html';
            break;

        case 'latex':
        case 'tex':
            output = exportToLatex(doc, {
                documentClass: settings.export.latex.documentClass,
                classOptions: parseClassOptions(settings.export.latex.classOptions),
                customHeader: settings.export.latex.customHeader,
            });
            defaultExt = '.tex';
            break;

        case 'pdf':
            // Export to LaTeX first, then compile
            const latex = exportToLatex(doc, {
                documentClass: settings.export.latex.documentClass,
                classOptions: parseClassOptions(settings.export.latex.classOptions),
                customHeader: settings.export.latex.customHeader,
            });
            defaultExt = '.pdf';
            output = await compilePdf(latex, inputPath, outputPath, settings.export);
            if (output === '__PDF_WRITTEN__') {
                return; // PDF was written directly
            }
            break;

        default:
            console.error(`Unknown format: ${format}`);
            console.error('Supported formats: html, latex, pdf');
            process.exit(1);
    }

    // Determine output path
    const outPath = outputPath || inputPath.replace(/\.org$/i, defaultExt);

    if (format !== 'pdf') {
        fs.writeFileSync(outPath, output);
        console.log(`Exported to: ${outPath}`);
    }
}

/**
 * Look for .bib file - checks settings first, then same directory
 */
function findBibFile(orgPath: string, refSettings: RefSettings): string | undefined {
    // First check configured bibliography files from settings
    for (const bibPath of refSettings.bibliographyFiles) {
        const expanded = expandPath(bibPath);
        if (fs.existsSync(expanded)) {
            return expanded;
        }
    }

    const dir = path.dirname(orgPath);
    const basename = path.basename(orgPath, '.org');

    // Check for same-name .bib file
    const sameName = path.join(dir, `${basename}.bib`);
    if (fs.existsSync(sameName)) {
        return sameName;
    }

    // Check for refs.bib or references.bib
    for (const name of ['refs.bib', 'references.bib', 'bibliography.bib']) {
        const bibPath = path.join(dir, name);
        if (fs.existsSync(bibPath)) {
            return bibPath;
        }
    }

    return undefined;
}

/**
 * Compile LaTeX to PDF using configured compiler from settings
 */
async function compilePdf(
    latex: string,
    inputPath: string,
    outputPath: string | undefined,
    exportSettings: ExportSettings
): Promise<string> {
    const { execSync } = await import('child_process');

    const dir = path.dirname(inputPath);
    const basename = path.basename(inputPath, '.org');
    const texPath = path.join(dir, `${basename}.tex`);
    const pdfPath = outputPath || path.join(dir, `${basename}.pdf`);

    // Write LaTeX file
    fs.writeFileSync(texPath, latex);

    // Build shell escape flag based on settings
    const shellEscape = exportSettings.pdf.shellEscape;
    const shellEscapeFlag = shellEscape === 'full' ? '-shell-escape' :
                           shellEscape === 'restricted' ? '-shell-restricted' : '';

    // Parse compiler setting
    const compiler = exportSettings.pdf.compiler;
    const extraArgs = exportSettings.pdf.extraArgs ? exportSettings.pdf.extraArgs.split(' ').filter(a => a) : [];

    console.log(`Using compiler: ${compiler}`);

    try {
        if (compiler.startsWith('latexmk')) {
            // Determine engine for latexmk
            let engine = '-pdf';
            if (compiler === 'latexmk-lualatex') {
                engine = '-lualatex';
            } else if (compiler === 'latexmk-xelatex') {
                engine = '-xelatex';
            } else if (compiler === 'latexmk-pdflatex') {
                engine = '-pdf';
            }

            const args = [engine, '-interaction=nonstopmode'];
            if (shellEscapeFlag) args.push(shellEscapeFlag);
            args.push(...extraArgs);
            args.push(`"${texPath}"`);

            console.log(`Running: latexmk ${args.join(' ')}`);
            execSync(`latexmk ${args.join(' ')}`, {
                cwd: dir,
                stdio: 'pipe',
            });
        } else {
            // Direct compiler (pdflatex, xelatex, lualatex)
            const compilerCmd = compiler;
            const args = ['-interaction=nonstopmode'];
            if (shellEscapeFlag) args.push(shellEscapeFlag);
            args.push(...extraArgs);
            args.push(`"${texPath}"`);

            console.log(`Running: ${compilerCmd} ${args.join(' ')}`);
            execSync(`${compilerCmd} ${args.join(' ')}`, {
                cwd: dir,
                stdio: 'pipe',
            });

            // Run twice for references
            execSync(`${compilerCmd} ${args.join(' ')}`, {
                cwd: dir,
                stdio: 'pipe',
            });
        }
    } catch (error) {
        console.error(`PDF compilation failed with ${compiler}.`);
        console.error('LaTeX file saved to:', texPath);
        process.exit(1);
    }

    // Clean auxiliary files if configured
    if (exportSettings.pdf.cleanAuxFiles) {
        const auxExtensions = ['.aux', '.log', '.out', '.toc', '.lof', '.lot', '.fls', '.fdb_latexmk'];
        for (const ext of auxExtensions) {
            const auxPath = path.join(dir, `${basename}${ext}`);
            if (fs.existsSync(auxPath)) {
                try {
                    fs.unlinkSync(auxPath);
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }

    // Move PDF to output location if different
    const generatedPdf = path.join(dir, `${basename}.pdf`);
    if (pdfPath !== generatedPdf && fs.existsSync(generatedPdf)) {
        fs.renameSync(generatedPdf, pdfPath);
    }

    console.log(`Exported to: ${pdfPath}`);
    return '__PDF_WRITTEN__';
}
