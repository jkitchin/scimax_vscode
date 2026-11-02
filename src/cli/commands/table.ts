/**
 * Table command - align org-mode and Markdown tables in files
 *
 * Uses the same table engine as the editor's table alignment (src/org/tableCore.ts),
 * so a file aligned here looks the same as one aligned with TAB in VS Code.
 */

import * as fs from 'fs';
import * as path from 'path';
import { alignTablesInText } from '../../org/tableCore';

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

const USAGE = `Usage: scimax table align <file>... [options]

Align every table in each file, in place. .md, .markdown and .qmd files get
Markdown tables; everything else is treated as org.

Options:
    --line <n>       Align only the table containing line n (1-based)
    --check          Do not write; exit 1 if any table is not aligned
    --stdout         Print the aligned text instead of writing (one file only)
    --raw-links      Measure links as written, not as their description
    --json           Output structured JSON`;

function languageFor(file: string): string {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.md' || ext === '.markdown') return 'markdown';
    if (ext === '.qmd') return 'quarto';
    return 'org';
}

export async function tableCommand(_config: CliConfig, args: ParsedArgs): Promise<void> {
    const sub = args.subcommand;
    const files = args.args.slice(1);
    // The CLI parser reads the word after any flag as its value, so a file
    // written after a boolean flag (--check a.org) lands there: take it back
    const flag = (name: string): boolean => {
        const value = args.flags[name];
        if (typeof value === 'string') files.push(value);
        return value !== undefined;
    };
    const json = flag('json');
    const check = flag('check');
    const toStdout = flag('stdout');
    const rawLinks = flag('raw-links');

    if (sub !== 'align' || files.length === 0) {
        console.error(USAGE);
        process.exit(sub === undefined ? 0 : 1);
    }

    let line: number | undefined;
    if (args.flags.line !== undefined) {
        const n = Number(args.flags.line);
        if (!Number.isInteger(n) || n < 1) {
            console.error('--line needs a line number (1 or more)');
            process.exit(1);
        }
        line = n - 1;
    }
    if (toStdout && files.length > 1) {
        console.error('--stdout works with one file');
        process.exit(1);
    }

    const results: { file: string; tables: number; changed: number; error?: string }[] = [];
    for (const file of files) {
        const filePath = path.resolve(file);
        if (!fs.existsSync(filePath)) {
            results.push({ file: filePath, tables: 0, changed: 0, error: 'File not found' });
            continue;
        }
        const original = fs.readFileSync(filePath, 'utf-8');
        const result = alignTablesInText(original, languageFor(filePath), {
            collapseLinks: !rawLinks,
            line,
        });
        if (toStdout) {
            process.stdout.write(result.text);
        } else if (!check && result.text !== original) {
            fs.writeFileSync(filePath, result.text, 'utf-8');
        }
        results.push({ file: filePath, tables: result.tables, changed: result.changed });
    }

    const failed = results.some(r => r.error);
    const unaligned = results.some(r => r.changed > 0);

    if (json) {
        console.log(JSON.stringify({ success: !failed && !(check && unaligned), check, files: results }));
    } else if (!toStdout) {
        for (const r of results) {
            if (r.error) {
                console.error(`${r.error}: ${r.file}`);
            } else if (line !== undefined && r.tables === 0) {
                console.error(`No table at line ${line + 1}: ${r.file}`);
            } else if (check) {
                console.log(r.changed > 0
                    ? `${r.file}: ${r.changed} of ${r.tables} table(s) not aligned`
                    : `${r.file}: ${r.tables} table(s) aligned`);
            } else {
                console.log(`${r.file}: aligned ${r.changed} of ${r.tables} table(s)`);
            }
        }
    }

    if (failed || (check && unaligned) || (line !== undefined && results.every(r => r.tables === 0))) {
        process.exit(1);
    }
}
