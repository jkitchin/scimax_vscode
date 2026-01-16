/**
 * Export command - convert org files to HTML, PDF, LaTeX
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseOrg } from '../../parser/orgParserUnified';
import { exportToHtml } from '../../parser/orgExportHtml';
import { exportToLatex } from '../../parser/orgExportLatex';
import { parseBibTeX } from '../../references/bibtexParser';

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

export async function exportCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const inputFile = args.args[0];

    if (!inputFile) {
        console.error('Usage: scimax export <file.org> [--format html|latex|pdf] [--output path]');
        process.exit(1);
    }

    const format = (typeof args.flags.format === 'string' ? args.flags.format : 'html').toLowerCase();
    const outputPath = typeof args.flags.output === 'string' ? args.flags.output : undefined;

    // Read input file
    const inputPath = path.resolve(inputFile);
    if (!fs.existsSync(inputPath)) {
        console.error(`File not found: ${inputPath}`);
        process.exit(1);
    }

    const content = fs.readFileSync(inputPath, 'utf-8');
    const doc = parseOrg(content);

    // Look for bibliography file
    let bibEntries;
    const bibFile = typeof args.flags.bib === 'string' ? args.flags.bib : findBibFile(inputPath);
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
            output = exportToLatex(doc, {});
            defaultExt = '.tex';
            break;

        case 'pdf':
            // Export to LaTeX first, then compile
            const latex = exportToLatex(doc, {});
            defaultExt = '.pdf';
            output = await compilePdf(latex, inputPath, outputPath);
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
 * Look for .bib file in same directory or specified in document
 */
function findBibFile(orgPath: string): string | undefined {
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
 * Compile LaTeX to PDF using pdflatex/latexmk
 */
async function compilePdf(latex: string, inputPath: string, outputPath?: string): Promise<string> {
    const { execSync } = await import('child_process');

    const dir = path.dirname(inputPath);
    const basename = path.basename(inputPath, '.org');
    const texPath = path.join(dir, `${basename}.tex`);
    const pdfPath = outputPath || path.join(dir, `${basename}.pdf`);

    // Write LaTeX file
    fs.writeFileSync(texPath, latex);

    try {
        // Try latexmk first (handles multiple passes)
        console.log('Compiling PDF with latexmk...');
        execSync(`latexmk -pdf -interaction=nonstopmode "${texPath}"`, {
            cwd: dir,
            stdio: 'pipe',
        });
    } catch {
        // Fall back to pdflatex
        try {
            console.log('Trying pdflatex...');
            execSync(`pdflatex -interaction=nonstopmode "${texPath}"`, {
                cwd: dir,
                stdio: 'pipe',
            });
            // Run twice for references
            execSync(`pdflatex -interaction=nonstopmode "${texPath}"`, {
                cwd: dir,
                stdio: 'pipe',
            });
        } catch (error) {
            console.error('PDF compilation failed. Is pdflatex installed?');
            console.error('LaTeX file saved to:', texPath);
            process.exit(1);
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
