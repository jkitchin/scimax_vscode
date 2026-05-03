/**
 * Project command - open a known project in VS Code
 *
 * Usage:
 *   scimax project                     Fuzzy-select from known projects
 *   scimax project <query>             Filter projects matching query
 *   scimax project --add <path>        Register a new project
 *   scimax project --remove <path>     Remove a project from the database
 *   scimax project --cleanup           Remove projects whose paths no longer exist
 *   scimax project --scan <dir>        Scan a directory for git/projectile projects
 *   scimax project --list              List all known projects
 *   scimax project --json              Output project list as JSON
 */

import { createCliDatabase } from '../database';
import type { ScimaxDbCore } from '../../database/scimaxDbCore';
import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

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

interface Project {
    path: string;
    name: string;
    type: string;
    last_opened: number | null;
}

/**
 * Check if fzf is available on the system
 */
function hasFzf(): boolean {
    try {
        execSync('which fzf', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Use fzf for fuzzy selection from a list of items
 */
function fzfSelect(items: string[], query?: string): Promise<string | null> {
    return new Promise((resolve) => {
        const args = ['--height', '40%', '--reverse', '--no-multi'];
        if (query) {
            args.push('--query', query);
        }
        args.push('--prompt', 'project> ');

        const fzf = spawn('fzf', args, {
            stdio: ['pipe', 'pipe', 'inherit'],
        });

        let selected = '';
        fzf.stdout.on('data', (data: Buffer) => {
            selected += data.toString();
        });

        fzf.on('close', (code: number | null) => {
            if (code === 0 && selected.trim()) {
                resolve(selected.trim());
            } else {
                resolve(null);
            }
        });

        fzf.stdin.write(items.join('\n'));
        fzf.stdin.end();
    });
}

/**
 * Simple numbered-list fallback when fzf is not available
 */
function numberedSelect(projects: Project[], query?: string): Promise<string | null> {
    let filtered = projects;
    if (query) {
        const q = query.toLowerCase();
        filtered = projects.filter(p =>
            p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
        );
    }

    if (filtered.length === 0) {
        console.log('No matching projects found.');
        return Promise.resolve(null);
    }

    if (filtered.length === 1) {
        return Promise.resolve(filtered[0].path);
    }

    console.log('Select a project:\n');
    for (let i = 0; i < filtered.length; i++) {
        const p = filtered[i];
        console.log(`  ${String(i + 1).padStart(3)}. ${p.name.padEnd(30)} ${p.path}`);
    }
    console.log();

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question('Enter number (or q to cancel): ', (answer) => {
            rl.close();
            const num = parseInt(answer, 10);
            if (num >= 1 && num <= filtered.length) {
                resolve(filtered[num - 1].path);
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * Format relative time for display
 */
function timeAgo(timestamp: number | null): string {
    if (!timestamp) return 'never';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}

export async function projectCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const json = args.flags.json === true;
    const list = args.flags.list === true;
    const add = args.flags.add;
    const remove = args.flags.remove;
    const cleanup = args.flags.cleanup === true;
    const scan = args.flags.scan;
    const query = args.subcommand || undefined;

    const db = await createCliDatabase(config.dbPath);

    // Cleanup: remove projects whose paths no longer exist on disk
    if (cleanup) {
        try {
            const removed = await db.cleanupProjects();
            if (json) {
                console.log(JSON.stringify({ removed }));
            } else {
                console.log(`Removed ${removed} non-existent project${removed === 1 ? '' : 's'}.`);
            }
        } finally {
            await db.close();
        }
        return;
    }

    // Remove a single project by path
    if (remove) {
        if (typeof remove !== 'string') {
            console.error('Error: --remove requires a path argument');
            await db.close();
            process.exit(1);
        }
        const resolved = path.resolve(remove);
        try {
            await db.removeProject(resolved);
            if (json) {
                console.log(JSON.stringify({ removed: resolved }));
            } else {
                console.log(`Removed project: ${resolved}`);
            }
        } finally {
            await db.close();
        }
        return;
    }

    // Scan a directory tree for git/projectile projects
    if (scan) {
        const dir = typeof scan === 'string' ? path.resolve(scan) : process.cwd();
        if (!fs.existsSync(dir)) {
            console.error(`Error: directory does not exist: ${dir}`);
            await db.close();
            process.exit(1);
        }
        try {
            const found = await db.scanForProjects(dir);
            if (json) {
                console.log(JSON.stringify({ found, directory: dir }));
            } else {
                console.log(`Found and registered ${found} project${found === 1 ? '' : 's'} under ${dir}.`);
            }
        } finally {
            await db.close();
        }
        return;
    }

    // Add a new project
    if (add) {
        const projectPath = typeof add === 'string' ? add : process.cwd();
        const resolved = path.resolve(projectPath);

        // Create directory if it doesn't exist
        if (!fs.existsSync(resolved)) {
            fs.mkdirSync(resolved, { recursive: true });
            console.log(`Created directory: ${resolved}`);
        }

        try {
            const result = await db.addProject(resolved);
            if (result) {
                console.log(`Added project: ${result.name} (${result.type})`);
                console.log(`  ${result.path}`);
            } else {
                console.error('Failed to add project.');
                await db.close();
                process.exit(1);
            }
        } finally {
            await db.close();
        }

        // Open in VS Code
        try {
            execSync(`code "${resolved}"`, { stdio: 'ignore' });
        } catch {
            // VS Code CLI not available
        }
        return;
    }

    let projects: Project[];

    try {
        projects = await db.getProjects();
    } catch {
        console.error('Error: Could not read projects from database.');
        console.error('Make sure scimax-vscode has been activated and has indexed projects.');
        await db.close();
        process.exit(1);
    } finally {
        await db.close();
    }

    if (projects.length === 0) {
        console.error('No known projects. Open folders in VS Code to register them, or use --add.');
        process.exit(1);
    }

    // JSON output
    if (json) {
        console.log(JSON.stringify({
            count: projects.length,
            projects: projects.map(p => ({
                name: p.name,
                path: p.path,
                type: p.type,
                last_opened: p.last_opened,
            })),
        }, null, 2));
        return;
    }

    // List mode
    if (list) {
        console.log('Known projects:\n');
        for (const p of projects) {
            const ago = timeAgo(p.last_opened);
            console.log(`  ${p.name.padEnd(30)} ${ago.padEnd(10)} ${p.path}`);
        }
        console.log(`\n${projects.length} projects total`);
        return;
    }

    // Interactive selection
    let selectedPath: string | null;

    if (hasFzf()) {
        // fzf mode: show "name  path" for each project
        const items = projects.map(p => `${p.name.padEnd(30)} ${p.path}`);
        const selected = await fzfSelect(items, query);
        // Extract path from the selected line (after the padded name)
        selectedPath = selected ? selected.replace(/^\S+\s+/, '').replace(/^.*?\s{2,}/, '').trim() : null;
        // More robust: find the project whose display line matches
        if (selected) {
            const idx = items.indexOf(selected);
            selectedPath = idx >= 0 ? projects[idx].path : null;
        }
    } else {
        selectedPath = await numberedSelect(projects, query);
    }

    if (!selectedPath) {
        return;
    }

    // Open in VS Code
    console.log(`Opening ${selectedPath}`);
    try {
        execSync(`code "${selectedPath}"`, { stdio: 'ignore' });
    } catch {
        console.error('Could not open VS Code. Is the `code` command available?');
        process.exit(1);
    }
}
