#!/usr/bin/env node
/**
 * Scimax CLI - Command-line interface for org-mode operations
 *
 * Usage:
 *   scimax agenda [today|week|todos]
 *   scimax search <query> [--semantic]
 *   scimax search headings [query] [-t tag] [--todo STATE]
 *   scimax export <file> [--format html|pdf|latex]
 *   scimax cite [extract|check] <file>
 *   scimax db [rebuild|stats]
 *   scimax journal [date]
 *   scimax project [query] [--add path] [--list]
 *   scimax publish [project] [--init|--list]
 */

// Must be first: installs a 'vscode' module stub so CLI can load code that
// transitively imports 'vscode' (e.g., utils/pathResolver).
import './vscodeStub';

import * as path from 'path';
import * as fs from 'fs';

// Commands
import { agendaCommand } from './commands/agenda';
import { searchCommand } from './commands/search';
import { exportCommand } from './commands/export';
import { citeCommand } from './commands/cite';
import { dbCommand } from './commands/db';
import { publishCommand } from './commands/publish';
import { skillCommand } from './commands/skill';
import { journalCommand } from './commands/journal';
import { projectCommand } from './commands/project';

interface CliConfig {
    dbPath: string;
    rootDir: string;
}

/**
 * Get the VS Code global storage path for the scimax extension
 */
function getVSCodeGlobalStoragePath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const platform = process.platform;

    let basePath: string;
    if (platform === 'darwin') {
        basePath = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
    } else if (platform === 'win32') {
        basePath = path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage');
    } else {
        // Linux and others
        basePath = path.join(home, '.config', 'Code', 'User', 'globalStorage');
    }

    return path.join(basePath, 'jkitchin.scimax-vscode', 'scimax-db.sqlite');
}

/**
 * Find scimax configuration - uses VS Code's global storage database
 */
function findConfig(): CliConfig {
    // Primary: VS Code extension's global storage database
    const vscodeDbPath = getVSCodeGlobalStoragePath();
    if (fs.existsSync(vscodeDbPath)) {
        return {
            dbPath: vscodeDbPath,
            rootDir: process.cwd(),
        };
    }

    // Fallback: check for local .scimax/config.json (for custom setups)
    let dir = process.cwd();
    while (dir !== path.dirname(dir)) {
        const configPath = path.join(dir, '.scimax', 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.dbPath && fs.existsSync(config.dbPath)) {
                return {
                    dbPath: config.dbPath,
                    rootDir: dir,
                    ...config,
                };
            }
        }
        dir = path.dirname(dir);
    }

    // Default: return VS Code path even if it doesn't exist yet
    // (will show a helpful error message)
    return {
        dbPath: vscodeDbPath,
        rootDir: process.cwd(),
    };
}

/**
 * Parse command-line arguments into structured format
 */
function parseArgs(args: string[]): { command: string; subcommand?: string; args: string[]; flags: Record<string, string | boolean> } {
    const flags: Record<string, string | boolean> = {};
    const positional: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = args[i + 1];
            if (next && !next.startsWith('-')) {
                flags[key] = next;
                i++;
            } else {
                flags[key] = true;
            }
        } else if (arg.startsWith('-') && arg.length === 2) {
            const key = arg.slice(1);
            const next = args[i + 1];
            if (next && !next.startsWith('-')) {
                flags[key] = next;
                i++;
            } else {
                flags[key] = true;
            }
        } else if (arg.startsWith('-')) {
            flags[arg.slice(1)] = true;
        } else {
            positional.push(arg);
        }
    }

    return {
        command: positional[0] || 'help',
        subcommand: positional[1],
        args: positional.slice(1),
        flags,
    };
}

function printHelp(): void {
    console.log(`
scimax - Org-mode CLI for scientific computing

USAGE:
    scimax <command> [options]

COMMANDS:
    agenda [view]           Show agenda (today, week, todos, overdue)
    search <query>          Full-text search across org files
    search headings         Search headings by title, tag, or TODO state
    export <file>           Export org file to HTML, PDF, or LaTeX
    cite <subcommand>       Citation operations (extract, check, convert)
    db <subcommand>         Database operations (rebuild, stats)
    journal [date]          Open journal entry (today, tomorrow, "next friday", etc.)
    project [query]         Fuzzy-select and open a known project in VS Code
    publish [project]       Publish org project(s) to HTML
    skill <subcommand>      Manage the scimax Claude Code skill
    help                    Show this help message

EXAMPLES:
    scimax agenda today
    scimax agenda todos --state NEXT
    scimax search "machine learning"
    scimax search "concepts" --semantic
    scimax search headings -t proposal
    scimax search headings --todo TODO -t grant
    scimax export paper.org --format html
    scimax export memo.org --exporter cmu-memo
    scimax export --list-exporters
    scimax cite extract paper.org
    scimax cite check paper.org --bib refs.bib
    scimax db rebuild
    scimax journal
    scimax journal tomorrow
    scimax journal --date "next friday"
    scimax project
    scimax project myapp
    scimax project --list
    scimax project --cleanup
    scimax project --remove /old/path
    scimax project --scan ~/projects
    scimax publish
    scimax publish --init
    scimax skill install
    scimax skill update

OPTIONS:
    --help, -h              Show help for a command
    --db <path>             Override database path
    --json                  Output structured JSON (agenda, search, db stats, cite, export, publish)
    --format <fmt>          Output format for export (html, pdf, latex)
    --exporter <id>         Use a custom exporter (e.g., cmu-memo)
    --list-exporters        List available custom exporters
    --output <path>         Output file or directory
`);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const config = findConfig();

    // Override db path if specified
    if (args.flags.db && typeof args.flags.db === 'string') {
        config.dbPath = args.flags.db;
    }

    if (args.flags.help || args.flags.h) {
        printHelp();
        process.exit(0);
    }

    try {
        switch (args.command) {
            case 'agenda':
                await agendaCommand(config, args);
                break;
            case 'search':
                await searchCommand(config, args);
                break;
            case 'export':
                await exportCommand(config, args);
                break;
            case 'cite':
                await citeCommand(config, args);
                break;
            case 'db':
                await dbCommand(config, args);
                break;
            case 'journal':
                await journalCommand(config, args);
                break;
            case 'project':
                await projectCommand(config, args);
                break;
            case 'publish':
                await publishCommand(config, args);
                break;
            case 'skill':
                await skillCommand(config, args);
                break;
            case 'help':
            default:
                printHelp();
                break;
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

main();
