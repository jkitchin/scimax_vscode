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
 * Find scimax configuration by walking up from cwd
 */
function findConfig(): CliConfig {
    let dir = process.cwd();

    while (dir !== path.dirname(dir)) {
        const configPath = path.join(dir, '.scimax', 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            return {
                dbPath: path.join(dir, '.scimax', 'org.db'),
                rootDir: dir,
                ...config,
            };
        }

        // Also check for just .scimax directory
        const scimaxDir = path.join(dir, '.scimax');
        if (fs.existsSync(scimaxDir)) {
            return {
                dbPath: path.join(scimaxDir, 'org.db'),
                rootDir: dir,
            };
        }

        dir = path.dirname(dir);
    }

    // Default: use cwd
    return {
        dbPath: path.join(process.cwd(), '.scimax', 'org.db'),
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
