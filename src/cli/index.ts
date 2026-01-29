#!/usr/bin/env node
/**
 * Scimax CLI - Command-line interface for org-mode operations
 *
 * Usage:
 *   scimax agenda [today|week|todos]
 *   scimax search <query> [--semantic]
 *   scimax find [--tag X] [--todo STATE]
 *   scimax export <file> [--format html|pdf|latex]
 *   scimax cite [extract|check] <file>
 *   scimax db [rebuild|stats]
 *   scimax publish [project] [--init|--list]
 */

import * as path from 'path';
import * as fs from 'fs';

// Commands
import { agendaCommand } from './commands/agenda';
import { searchCommand } from './commands/search';
import { exportCommand } from './commands/export';
import { citeCommand } from './commands/cite';
import { dbCommand } from './commands/db';
import { publishCommand } from './commands/publish';

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
    find                    Find files by tag, property, or TODO state
    export <file>           Export org file to HTML, PDF, or LaTeX
    cite <subcommand>       Citation operations (extract, check, convert)
    db <subcommand>         Database operations (rebuild, stats)
    publish [project]       Publish org project(s) to HTML
    help                    Show this help message

EXAMPLES:
    scimax agenda today
    scimax agenda todos --state NEXT
    scimax search "machine learning"
    scimax find --tag research --todo TODO
    scimax export paper.org --format html
    scimax cite extract paper.org
    scimax cite check paper.org --bib refs.bib
    scimax db rebuild
    scimax publish
    scimax publish --init

OPTIONS:
    --help, -h              Show help for a command
    --db <path>             Override database path
    --format <fmt>          Output format (html, pdf, latex, json)
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
            case 'publish':
                await publishCommand(config, args);
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
