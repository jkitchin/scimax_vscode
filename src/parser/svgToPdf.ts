/**
 * SVG -> PDF conversion for the LaTeX/PDF export pipeline.
 *
 * LuaLaTeX/pdfLaTeX cannot embed `.svg` files directly, so an org file that
 * references `[[file:fig.svg]]` produces `\includegraphics{fig.svg}` and the
 * PDF build aborts with "Unknown graphics extension: .svg".
 *
 * This module pre-converts each referenced SVG to PDF (using whichever
 * converter is installed) and rewrites the `\includegraphics` path to point at
 * the generated PDF. This keeps `-shell-escape` off and avoids an Inkscape
 * dependency at compile time.
 *
 * See GitHub issue #49.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

/** A converter we know how to drive: command name + argument builder. */
interface SvgConverter {
    /** Executable name, looked up on PATH. */
    cmd: string;
    /** Build the argument vector converting `svg` -> `pdf`. */
    args: (svg: string, pdf: string) => string[];
}

/**
 * Converters tried in order of preference. All are pure SVG->PDF and none
 * require `-shell-escape`. `rsvg-convert` is preferred (fast, portable, no
 * headless-browser or full Inkscape startup cost).
 */
const CONVERTERS: SvgConverter[] = [
    { cmd: 'rsvg-convert', args: (svg, pdf) => ['-f', 'pdf', '-o', pdf, svg] },
    { cmd: 'cairosvg', args: (svg, pdf) => [svg, '-o', pdf] },
    { cmd: 'inkscape', args: (svg, pdf) => [svg, '--export-type=pdf', `--export-filename=${pdf}`] },
];

/** Matches `\includegraphics[opts]{path.svg}` (opts optional). */
const SVG_INCLUDE_RE = /\\includegraphics(\[[^\]]*\])?\{([^}]*\.svg)\}/gi;

export interface SvgConversionResult {
    /** LaTeX source with convertible `.svg` include paths rewritten to `.pdf`. */
    latex: string;
    /** Absolute paths of PDF files produced (useful for cleanup). */
    converted: string[];
    /** SVGs that could not be converted, with a human-readable reason. */
    failed: Array<{ svg: string; reason: string }>;
    /** Name of the converter used, or undefined if none was found/needed. */
    converter?: string;
}

/** Return true if `cmd` is runnable on this system. */
function isAvailable(cmd: string): boolean {
    try {
        // `--version` is cheap and supported by all three converters. stdio is
        // ignored so nothing leaks to the user's terminal.
        execFileSync(cmd, ['--version'], { stdio: 'ignore', timeout: 10000 });
        return true;
    } catch {
        return false;
    }
}

/** Find the first available converter, or undefined if none is installed. */
export function findSvgConverter(): SvgConverter | undefined {
    return CONVERTERS.find(c => isAvailable(c.cmd));
}

/**
 * The derived-PDF path for an SVG. We append `.pdf` (e.g. `fig.svg.pdf`) rather
 * than replacing the extension (`fig.pdf`) so a hand-made `fig.pdf` next to the
 * SVG is never clobbered, and the artifact is obviously derived.
 */
export function derivedPdfPath(svgAbsPath: string): string {
    return `${svgAbsPath}.pdf`;
}

/**
 * Convert a single SVG file to PDF. Returns true on success. Regenerates only
 * when the SVG is newer than an existing derived PDF (cheap incremental builds).
 */
function convertOne(converter: SvgConverter, svgAbs: string, pdfAbs: string): boolean {
    try {
        if (fs.existsSync(pdfAbs)) {
            const svgStat = fs.statSync(svgAbs);
            const pdfStat = fs.statSync(pdfAbs);
            if (pdfStat.mtimeMs >= svgStat.mtimeMs) {
                return true; // up to date
            }
        }
        execFileSync(converter.cmd, converter.args(svgAbs, pdfAbs), {
            stdio: 'ignore',
            timeout: 60000,
        });
        return fs.existsSync(pdfAbs);
    } catch {
        return false;
    }
}

/**
 * Scan LaTeX for `\includegraphics{...svg}`, convert each referenced SVG to PDF
 * relative to `baseDir`, and rewrite the include paths to the generated PDFs.
 *
 * SVGs that resolve to a missing file, or that fail to convert, are left as-is
 * and reported in `failed` so the caller can warn. If no SVG includes are
 * present the input is returned unchanged with no converter lookup.
 */
export function convertSvgIncludesToPdf(latex: string, baseDir: string): SvgConversionResult {
    const result: SvgConversionResult = { latex, converted: [], failed: [] };

    // Collect distinct svg paths as written in the .tex (relative or absolute).
    const svgPaths = new Set<string>();
    for (const m of latex.matchAll(SVG_INCLUDE_RE)) {
        svgPaths.add(m[2]);
    }
    if (svgPaths.size === 0) {
        return result;
    }

    const converter = findSvgConverter();
    if (!converter) {
        for (const p of svgPaths) {
            result.failed.push({
                svg: p,
                reason: 'no SVG converter found (install rsvg-convert, cairosvg, or inkscape)',
            });
        }
        return result;
    }
    result.converter = converter.cmd;

    // Map each successfully converted svg path -> its rewritten pdf path.
    const rewrite = new Map<string, string>();
    for (const svgPath of svgPaths) {
        const svgAbs = path.isAbsolute(svgPath) ? svgPath : path.resolve(baseDir, svgPath);
        if (!fs.existsSync(svgAbs)) {
            result.failed.push({ svg: svgPath, reason: `file not found: ${svgAbs}` });
            continue;
        }
        const pdfAbs = derivedPdfPath(svgAbs);
        if (convertOne(converter, svgAbs, pdfAbs)) {
            // Preserve relative/absolute form: append `.pdf` to the written path.
            rewrite.set(svgPath, `${svgPath}.pdf`);
            result.converted.push(pdfAbs);
        } else {
            result.failed.push({ svg: svgPath, reason: `${converter.cmd} failed to convert` });
        }
    }

    if (rewrite.size > 0) {
        result.latex = latex.replace(SVG_INCLUDE_RE, (full, opts, p) => {
            const replacement = rewrite.get(p);
            return replacement ? `\\includegraphics${opts || ''}{${replacement}}` : full;
        });
    }

    return result;
}
