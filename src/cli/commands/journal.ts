/**
 * Journal command - open journal entries from the CLI
 *
 * Usage:
 *   scimax journal                    Open today's journal entry
 *   scimax journal tomorrow           Open a specific date's journal entry
 *   scimax journal --date "next friday"
 *   scimax journal --date 2026-03-15
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadSettings } from '../settings';
import { parseRelativeDate, getDateExpressionExamples } from '../../utils/dateParser';
import { vscodeLinkAt } from '../links';
import { renderJournalEntry, buildTemplateContext } from '../../journal/journalTemplates';

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
 * Get the journal entry path for a given date, mirroring JournalManager.getEntryPath
 */
function getEntryPath(directory: string, format: string, date: Date): string {
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const ext = format === 'org' ? '.org' : '.md';
    const filename = `${year}-${month}-${day}${ext}`;

    return path.join(directory, year, month, day, filename);
}

/**
 * Expand ~ to home directory
 */
function expandPath(p: string): string {
    if (p.startsWith('~')) {
        const home = process.env.HOME || process.env.USERPROFILE || '';
        return path.join(home, p.slice(1));
    }
    return p;
}

export async function journalCommand(_config: CliConfig, args: ParsedArgs): Promise<void> {
    const settings = loadSettings();
    const journalDir = expandPath(settings.journal.directory);
    const format = settings.journal.format || 'org';

    if (!journalDir) {
        console.error('Error: No journal directory configured.');
        console.error('Set scimax.journal.directory in VS Code settings.');
        process.exit(1);
    }

    // Determine the target date
    let date = new Date();
    date.setHours(0, 0, 0, 0);

    if (args.flags.date && typeof args.flags.date === 'string') {
        const parsed = parseRelativeDate(args.flags.date);
        if (!parsed) {
            console.error(`Error: Could not parse date "${args.flags.date}"`);
            console.error(getDateExpressionExamples());
            process.exit(1);
        }
        date = parsed;
    } else if (args.subcommand) {
        // Allow "scimax journal tomorrow" without --date
        const parsed = parseRelativeDate(args.subcommand + (args.args.length > 1 ? ' ' + args.args.slice(1).join(' ') : ''));
        if (parsed) {
            date = parsed;
        } else {
            console.error(`Error: Could not parse date "${args.subcommand}"`);
            console.error(getDateExpressionExamples());
            process.exit(1);
        }
    }

    const entryPath = getEntryPath(journalDir, format, date);
    const exists = fs.existsSync(entryPath);

    // Create the entry if it doesn't exist
    if (!exists) {
        const entryDir = path.dirname(entryPath);
        fs.mkdirSync(entryDir, { recursive: true });
        const content = renderJournalEntry(date, {
            templateName: settings.journal.template || 'default',
            format,
            customTemplate: settings.journal.customTemplate || undefined,
        });
        fs.writeFileSync(entryPath, content, 'utf8');
    }

    const ctx = buildTemplateContext(date);

    if (args.flags.json === true) {
        console.log(JSON.stringify({
            date: ctx.date,
            weekday: ctx.weekday,
            path: entryPath,
            created: !exists,
        }, null, 2));
    } else {
        if (!exists) {
            console.log(`Created journal entry for ${ctx.date} (${ctx.weekday})`);
        }
        console.log(vscodeLinkAt(entryPath, 1));
    }

    // Open in VS Code
    const { execSync } = await import('child_process');
    try {
        execSync(`code "${entryPath}"`, { stdio: 'ignore' });
    } catch {
        // VS Code CLI not available, just show the path
    }
}
