/**
 * Citation command - extract, check, and convert citations
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseCitationsFromLine, convertCitationSyntax } from '../../references/citationParser';
import { parseBibTeX } from '../../references/bibtexParser';
import type { ParsedCitation } from '../../references/citationTypes';

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

export async function citeCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const subcommand = args.subcommand || 'help';

    switch (subcommand) {
        case 'extract':
            await extractCitations(args);
            break;
        case 'check':
            await checkCitations(args);
            break;
        case 'convert':
            await convertCitations(args);
            break;
        case 'list':
            await listBibEntries(args);
            break;
        default:
            console.log(`
scimax cite - Citation operations

USAGE:
    scimax cite extract <file.org>     Extract all citation keys
    scimax cite check <file.org>       Check citations against bibliography
    scimax cite convert <file.org>     Convert citation syntax (v2 <-> v3)
    scimax cite list <file.bib>        List bibliography entries

OPTIONS:
    --bib <file.bib>    Bibliography file
    --from <syntax>     Source syntax (v2, v3, org-cite)
    --to <syntax>       Target syntax (v2, v3, org-cite)
    --format <fmt>      Output format (text, json)
`);
    }
}

async function extractCitations(args: ParsedArgs): Promise<void> {
    const inputFile = args.args[1];
    if (!inputFile) {
        console.error('Usage: scimax cite extract <file.org>');
        process.exit(1);
    }

    const content = fs.readFileSync(inputFile, 'utf-8');
    const lines = content.split('\n');

    const allCitations: ParsedCitation[] = [];
    const allKeys = new Set<string>();

    for (const line of lines) {
        const citations = parseCitationsFromLine(line);
        for (const citation of citations) {
            allCitations.push(citation);
            for (const ref of citation.references) {
                allKeys.add(ref.key);
            }
        }
    }

    const format = args.flags.format || 'text';

    if (format === 'json') {
        console.log(JSON.stringify({
            file: inputFile,
            citationCount: allCitations.length,
            uniqueKeys: [...allKeys].sort(),
            citations: allCitations,
        }, null, 2));
    } else {
        console.log(`Found ${allCitations.length} citation(s) with ${allKeys.size} unique key(s):\n`);
        for (const key of [...allKeys].sort()) {
            console.log(`  ${key}`);
        }
    }
}

async function checkCitations(args: ParsedArgs): Promise<void> {
    const inputFile = args.args[1];
    if (!inputFile) {
        console.error('Usage: scimax cite check <file.org> --bib <file.bib>');
        process.exit(1);
    }

    // Find bibliography file
    const bibFile = typeof args.flags.bib === 'string'
        ? args.flags.bib
        : findBibFile(inputFile);

    if (!bibFile || !fs.existsSync(bibFile)) {
        console.error('Bibliography file not found. Use --bib to specify.');
        process.exit(1);
    }

    // Parse org file for citations
    const orgContent = fs.readFileSync(inputFile, 'utf-8');
    const citedKeys = new Set<string>();

    for (const line of orgContent.split('\n')) {
        for (const citation of parseCitationsFromLine(line)) {
            for (const ref of citation.references) {
                citedKeys.add(ref.key);
            }
        }
    }

    // Parse bibliography
    const bibContent = fs.readFileSync(bibFile, 'utf-8');
    const parseResult = parseBibTeX(bibContent);
    const bibEntries = parseResult.entries;
    const bibKeys = new Set(bibEntries.map((e: { key: string }) => e.key));

    // Check for issues
    const missing = [...citedKeys].filter(k => !bibKeys.has(k)).sort();
    const unused = [...bibKeys].filter(k => !citedKeys.has(k)).sort();

    console.log(`Citation Check: ${inputFile}\n`);
    console.log(`  Citations found: ${citedKeys.size}`);
    console.log(`  Bibliography entries: ${bibKeys.size}`);
    console.log();

    if (missing.length > 0) {
        console.log(`MISSING (${missing.length} cited but not in .bib):`);
        for (const key of missing) {
            console.log(`  - ${key}`);
        }
        console.log();
    }

    if (unused.length > 0) {
        console.log(`UNUSED (${unused.length} in .bib but not cited):`);
        for (const key of unused) {
            console.log(`  - ${key}`);
        }
        console.log();
    }

    if (missing.length === 0 && unused.length === 0) {
        console.log('All citations are valid and all bibliography entries are used.');
    }

    // Exit with error if missing citations
    if (missing.length > 0) {
        process.exit(1);
    }
}

async function convertCitations(args: ParsedArgs): Promise<void> {
    const inputFile = args.args[1];
    if (!inputFile) {
        console.error('Usage: scimax cite convert <file.org> --from v2 --to v3');
        process.exit(1);
    }

    const fromSyntax = (args.flags.from as string) || 'v2';
    const toSyntax = (args.flags.to as string) || 'v3';

    const syntaxMap: Record<string, 'org-ref-v2' | 'org-ref-v3' | 'org-cite'> = {
        'v2': 'org-ref-v2',
        'v3': 'org-ref-v3',
        'org-cite': 'org-cite',
    };

    const targetSyntax = syntaxMap[toSyntax];
    if (!targetSyntax) {
        console.error(`Unknown target syntax: ${toSyntax}`);
        console.error('Supported: v2, v3, org-cite');
        process.exit(1);
    }

    const content = fs.readFileSync(inputFile, 'utf-8');
    const lines = content.split('\n');
    const newLines: string[] = [];
    let conversions = 0;

    for (const line of lines) {
        const citations = parseCitationsFromLine(line);

        if (citations.length === 0) {
            newLines.push(line);
            continue;
        }

        // Convert citations in reverse order to preserve positions
        let newLine = line;
        for (const citation of [...citations].reverse()) {
            if (citation.syntax !== targetSyntax) {
                const converted = convertCitationSyntax(citation, targetSyntax);
                newLine = newLine.slice(0, citation.range.start) +
                    converted +
                    newLine.slice(citation.range.end);
                conversions++;
            }
        }
        newLines.push(newLine);
    }

    const output = newLines.join('\n');

    if (args.flags.output && typeof args.flags.output === 'string') {
        fs.writeFileSync(args.flags.output, output);
        console.log(`Converted ${conversions} citation(s) to ${args.flags.output}`);
    } else if (args.flags.inplace || args.flags.i) {
        fs.writeFileSync(inputFile, output);
        console.log(`Converted ${conversions} citation(s) in place`);
    } else {
        // Print to stdout
        console.log(output);
    }
}

async function listBibEntries(args: ParsedArgs): Promise<void> {
    const bibFile = args.args[1];
    if (!bibFile) {
        console.error('Usage: scimax cite list <file.bib>');
        process.exit(1);
    }

    const content = fs.readFileSync(bibFile, 'utf-8');
    const parseResult = parseBibTeX(content);
    const entries = parseResult.entries;

    const format = args.flags.format || 'text';

    if (format === 'json') {
        console.log(JSON.stringify(entries, null, 2));
    } else {
        console.log(`Bibliography: ${bibFile}\n`);
        console.log(`${entries.length} entries:\n`);

        for (const entry of entries) {
            const author = entry.author?.split(' and ')[0] || 'Unknown';
            const year = entry.year || 'n.d.';
            const title = entry.title?.slice(0, 60) || 'Untitled';
            console.log(`  ${entry.key}`);
            console.log(`    ${author} (${year}). ${title}...`);
        }
    }
}

function findBibFile(orgPath: string): string | undefined {
    const dir = path.dirname(orgPath);
    const basename = path.basename(orgPath, '.org');

    for (const name of [`${basename}.bib`, 'refs.bib', 'references.bib']) {
        const bibPath = path.join(dir, name);
        if (fs.existsSync(bibPath)) {
            return bibPath;
        }
    }
    return undefined;
}
