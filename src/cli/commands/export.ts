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
import { exportToBeamer, BeamerExportOptions } from '../../parser/orgExportBeamer';
import { parseBibTeX } from '../../references/bibtexParser';
import { loadSettings, expandPath, ExportSettings, RefSettings } from '../settings';
import {
    initializeExporterRegistry,
    executeCustomExport,
    ExporterRegistry,
} from '../../export/customExporter';

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

/**
 * Build BeamerExportOptions from VS Code-style settings.
 */
function buildBeamerOptions(exportSettings: ExportSettings): Partial<BeamerExportOptions> {
    const b = exportSettings.beamer;
    const opts: Partial<BeamerExportOptions> = {
        documentClass: 'beamer',
        classOptions: parseClassOptions(b.classOptions),
        preamble: b.defaultPreamble || undefined,
        frameLevel: b.frameLevel,
        boldIsAlert: b.boldIsAlert,
        aspectRatio: b.aspectRatio,
    };
    if (b.theme) opts.theme = b.theme;
    if (b.colorTheme) opts.colorTheme = b.colorTheme;
    if (b.fontTheme) opts.fontTheme = b.fontTheme;
    if (b.innerTheme) opts.innerTheme = b.innerTheme;
    if (b.outerTheme) opts.outerTheme = b.outerTheme;
    return opts;
}

export async function exportCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const inputFile = args.args[0];

    if (!inputFile && !args.flags['list-exporters']) {
        console.error('Usage: scimax export <file.org> [--format html|latex|pdf|beamer|beamer-pdf] [--exporter <id>] [--output path] [--json]');
        console.error('       scimax export --list-exporters');
        process.exit(1);
    }

    // Load settings from VS Code settings.json
    const settings = loadSettings();

    const json = args.flags.json === true;
    const format = (typeof args.flags.format === 'string' ? args.flags.format : 'html').toLowerCase();
    const outputPath = typeof args.flags.output === 'string' ? args.flags.output : undefined;
    const exporterId = typeof args.flags.exporter === 'string' ? args.flags.exporter : undefined;

    // Handle --list-exporters (can be invoked without input file)
    if (args.flags['list-exporters']) {
        await initializeExporterRegistry();
        const registry = ExporterRegistry.getInstance();
        const exporters = registry.getAll();
        if (json) {
            console.log(JSON.stringify({
                success: true,
                exporters: exporters.map(e => ({
                    id: e.id,
                    name: e.name,
                    description: e.description,
                    parent: e.parent,
                    outputFormat: e.outputFormat,
                })),
            }));
        } else if (exporters.length === 0) {
            console.log('No custom exporters found.');
            console.log('Place exporter definitions under ~/scimax/exporters/<id>/');
        } else {
            console.log(`Found ${exporters.length} custom exporter(s):`);
            for (const e of exporters) {
                console.log(`  ${e.id.padEnd(20)} ${e.name} (${e.parent} → ${e.outputFormat})`);
                if (e.description) console.log(`    ${e.description}`);
            }
        }
        return;
    }

    // Read input file
    const inputPath = path.resolve(inputFile);
    if (!fs.existsSync(inputPath)) {
        if (json) {
            console.log(JSON.stringify({ success: false, error: `File not found: ${inputPath}` }));
        } else {
            console.error(`File not found: ${inputPath}`);
        }
        process.exit(1);
    }

    const content = fs.readFileSync(inputPath, 'utf-8');

    // Custom exporter path (bypasses normal format switch)
    if (exporterId) {
        await runCustomExporter(exporterId, content, inputPath, outputPath, settings.export, json);
        return;
    }

    const doc = parseOrgFast(content);

    // Look for bibliography file (check settings first, then local files)
    let bibEntries;
    const bibFile = typeof args.flags.bib === 'string'
        ? args.flags.bib
        : findBibFile(inputPath, settings.ref);
    if (bibFile && fs.existsSync(bibFile)) {
        // Route info messages to stderr in JSON mode so stdout is clean
        process.stderr.write(`Using bibliography: ${bibFile}\n`);
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
                preamble: settings.export.latex.defaultPreamble,
                customHeader: settings.export.latex.customHeader,
                citeBackend: settings.export.latex.citeBackend === 'biblatex' ? 'biblatex' : 'bibtex',
            });
            defaultExt = '.tex';
            break;

        case 'pdf': {
            // Export to LaTeX first, then compile
            const latex = exportToLatex(doc, {
                documentClass: settings.export.latex.documentClass,
                classOptions: parseClassOptions(settings.export.latex.classOptions),
                preamble: settings.export.latex.defaultPreamble,
                customHeader: settings.export.latex.customHeader,
                citeBackend: settings.export.latex.citeBackend === 'biblatex' ? 'biblatex' : 'bibtex',
            });
            defaultExt = '.pdf';
            output = await compilePdf(latex, inputPath, outputPath, settings.export, json);
            if (output === '__PDF_WRITTEN__') {
                if (json) {
                    const pdfOut = outputPath || inputPath.replace(/\.org$/i, '.pdf');
                    console.log(JSON.stringify({ success: true, input_file: inputPath, output_path: pdfOut, format: 'pdf' }));
                }
                return;
            }
            break;
        }

        case 'beamer':
        case 'beamer-tex':
            output = exportToBeamer(doc, buildBeamerOptions(settings.export));
            defaultExt = '.tex';
            break;

        case 'beamer-pdf': {
            const beamerTex = exportToBeamer(doc, buildBeamerOptions(settings.export));
            defaultExt = '.pdf';
            output = await compilePdf(beamerTex, inputPath, outputPath, settings.export, json);
            if (output === '__PDF_WRITTEN__') {
                if (json) {
                    const pdfOut = outputPath || inputPath.replace(/\.org$/i, '.pdf');
                    console.log(JSON.stringify({ success: true, input_file: inputPath, output_path: pdfOut, format: 'beamer-pdf' }));
                }
                return;
            }
            break;
        }

        default:
            if (json) {
                console.log(JSON.stringify({ success: false, error: `Unknown format: ${format}. Supported: html, latex, pdf, beamer, beamer-pdf` }));
            } else {
                console.error(`Unknown format: ${format}`);
                console.error('Supported formats: html, latex, pdf, beamer, beamer-pdf');
            }
            process.exit(1);
    }

    // Determine output path
    const outPath = outputPath || inputPath.replace(/\.org$/i, defaultExt!);

    if (format !== 'pdf') {
        fs.writeFileSync(outPath, output!);
        if (json) {
            console.log(JSON.stringify({ success: true, input_file: inputPath, output_path: outPath, format }));
        } else {
            console.log(`Exported to: ${outPath}`);
        }
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
 * Run a custom exporter (e.g., cmu-memo) and write/compile its output.
 */
async function runCustomExporter(
    exporterId: string,
    content: string,
    inputPath: string,
    outputPath: string | undefined,
    exportSettings: ExportSettings,
    json: boolean
): Promise<void> {
    const log = (msg: string) => json ? process.stderr.write(msg + '\n') : console.log(msg);

    await initializeExporterRegistry();
    const registry = ExporterRegistry.getInstance();
    const exporter = registry.get(exporterId);

    if (!exporter) {
        const available = registry.getAll().map(e => e.id).join(', ') || '(none)';
        const errMsg = `Custom exporter not found: ${exporterId}. Available: ${available}`;
        if (json) {
            console.log(JSON.stringify({ success: false, error: errMsg }));
        } else {
            console.error(errMsg);
            console.error('Run "scimax export --list-exporters" to see all available exporters.');
        }
        process.exit(1);
    }

    let rendered: string;
    try {
        rendered = await executeCustomExport(exporterId, content);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (json) {
            console.log(JSON.stringify({ success: false, error: `Custom export failed: ${msg}` }));
        } else {
            console.error(`Custom export failed: ${msg}`);
        }
        process.exit(1);
    }

    if (exporter.outputFormat === 'pdf') {
        log(`Using exporter: ${exporter.name} (${exporter.id})`);
        const result = await compilePdf(rendered, inputPath, outputPath, exportSettings, json);
        if (result === '__PDF_WRITTEN__' && json) {
            const pdfOut = outputPath || inputPath.replace(/\.org$/i, '.pdf');
            console.log(JSON.stringify({
                success: true,
                input_file: inputPath,
                output_path: pdfOut,
                format: 'pdf',
                exporter: exporterId,
            }));
        }
        return;
    }

    // Non-PDF custom exporter: write rendered content to output path
    const ext = `.${exporter.outputFormat}`;
    const outPath = outputPath || inputPath.replace(/\.org$/i, ext);
    fs.writeFileSync(outPath, rendered);
    if (json) {
        console.log(JSON.stringify({
            success: true,
            input_file: inputPath,
            output_path: outPath,
            format: exporter.outputFormat,
            exporter: exporterId,
        }));
    } else {
        console.log(`Exported to: ${outPath}`);
    }
}

/**
 * Compile LaTeX to PDF using configured compiler from settings
 */
async function compilePdf(
    latex: string,
    inputPath: string,
    outputPath: string | undefined,
    exportSettings: ExportSettings,
    json: boolean = false
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

    // Route progress to stderr in JSON mode
    const log = (msg: string) => json ? process.stderr.write(msg + '\n') : console.log(msg);

    log(`Using compiler: ${compiler}`);

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

            log(`Running: latexmk ${args.join(' ')}`);
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

            log(`Running: ${compilerCmd} ${args.join(' ')}`);
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
        if (json) {
            console.log(JSON.stringify({ success: false, error: `PDF compilation failed with ${compiler}`, tex_file: texPath }));
        } else {
            console.error(`PDF compilation failed with ${compiler}.`);
            console.error('LaTeX file saved to:', texPath);
        }
        process.exit(1);
    }

    // Clean auxiliary files if configured
    if (exportSettings.pdf.cleanAuxFiles) {
        const auxExtensions = [
            '.aux', '.log', '.out', '.toc', '.lof', '.lot', '.fls', '.fdb_latexmk',
            // Beamer-specific
            '.nav', '.snm', '.vrb',
        ];
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
        // Beamer numbered per-frame verbatim caches: <basename>.<N>.vrb
        try {
            const vrbPattern = new RegExp(`^${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+\\.vrb$`);
            for (const entry of fs.readdirSync(dir)) {
                if (vrbPattern.test(entry)) {
                    try { fs.unlinkSync(path.join(dir, entry)); } catch { /* ignore */ }
                }
            }
        } catch {
            // Ignore directory read errors
        }
    }

    // Move PDF to output location if different
    const generatedPdf = path.join(dir, `${basename}.pdf`);
    if (pdfPath !== generatedPdf && fs.existsSync(generatedPdf)) {
        fs.renameSync(generatedPdf, pdfPath);
    }

    log(`Exported to: ${pdfPath}`);
    return '__PDF_WRITTEN__';
}
