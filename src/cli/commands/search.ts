/**
 * Search command - full-text, semantic, and heading search across org files
 */

import { createCliDatabase, createCliEmbeddingService } from '../database';
import type { ScimaxDbCore, SearchResult, HeadingRecord } from '../../database/scimaxDbCore';
import { vscodeLinkAt } from '../links';
import { loadSettings } from '../settings';

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

export async function searchCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    // Dispatch subcommand
    if (args.subcommand === 'headings') {
        return searchHeadingsCommand(config, args);
    }

    const query = args.args[0];

    if (!query) {
        console.error(`Usage:
  scimax search <query> [--semantic] [--limit N] [--json]
  scimax search headings [query] [-t tag] [--todo STATE] [--limit N] [--json]`);
        process.exit(1);
    }

    const db = await createCliDatabase(config.dbPath);
    const limit = typeof args.flags.limit === 'string' ? parseInt(args.flags.limit, 10) : 20;
    const semantic = args.flags.semantic === true;
    const json = args.flags.json === true;

    // Wire up embedding service from VS Code settings if needed
    if (semantic) {
        const settings = loadSettings();
        const embeddingService = createCliEmbeddingService(settings.embedding);
        if (embeddingService) {
            db.setEmbeddingService(embeddingService);
        }
    }

    try {
        if (semantic) {
            await searchSemantic(db, query, limit, json);
        } else {
            await searchFullText(db, query, limit, json);
        }
    } finally {
        await db.close();
    }
}

async function searchHeadingsCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    // args.args is [subcommand, ...rest], so query is args.args[1]
    const query = args.args[1] || '';
    const tag = (args.flags.t || args.flags.tag) as string | undefined;
    const todoState = (args.flags.todo) as string | undefined;
    const limit = typeof args.flags.limit === 'string' ? parseInt(args.flags.limit, 10) : 50;
    const json = args.flags.json === true;

    if (!query && !tag && !todoState) {
        console.error(`Usage: scimax search headings [query] [-t tag] [--todo STATE] [--limit N] [--json]

Examples:
  scimax search headings "proposal"           Search heading titles
  scimax search headings -t proposal           Find headings tagged :proposal:
  scimax search headings --todo TODO           Find all TODO headings
  scimax search headings -t grant --todo NEXT  Combine filters`);
        process.exit(1);
    }

    const db = await createCliDatabase(config.dbPath);

    try {
        const results = await db.searchHeadings(query, { tag, todoState, limit });
        displayHeadings(results, { query, tag, todoState, json });
    } finally {
        await db.close();
    }
}

function displayHeadings(results: HeadingRecord[], opts: {
    query: string; tag?: string; todoState?: string; json: boolean;
}): void {
    if (opts.json) {
        console.log(JSON.stringify({
            query: opts.query || null,
            tag: opts.tag || null,
            todo_state: opts.todoState || null,
            count: results.length,
            results: results.map(r => ({
                title: r.title,
                file_path: r.file_path,
                line_number: r.line_number,
                level: r.level,
                todo_state: r.todo_state || null,
                tags: r.tags ? JSON.parse(r.tags) : [],
                priority: r.priority || null,
            })),
        }, null, 2));
        return;
    }

    // Build description of what we searched for
    const parts: string[] = [];
    if (opts.query) { parts.push(`title matching "${opts.query}"`); }
    if (opts.tag) { parts.push(`tag :${opts.tag}:`); }
    if (opts.todoState) { parts.push(`state ${opts.todoState}`); }
    console.log(`Searching headings: ${parts.join(', ')}\n`);

    if (results.length === 0) {
        console.log('No headings found.');
        return;
    }

    console.log(`Found ${results.length} heading(s):\n`);

    for (let i = 0; i < results.length; i++) {
        const h = results[i];
        const todo = h.todo_state ? `${h.todo_state} ` : '';
        const tags = h.tags ? ` ${JSON.parse(h.tags).map((t: string) => `:${t}:`).join('')}` : '';
        const stars = '*'.repeat(h.level);
        const link = vscodeLinkAt(h.file_path, h.line_number);
        console.log(`  ${String(i + 1).padStart(3)}. ${stars} ${todo}${h.title}${tags}`);
        console.log(`       ${link}`);
    }
}

async function searchFullText(db: ScimaxDbCore, query: string, limit: number, json: boolean): Promise<void> {
    const results = await db.searchFullText(query, { limit });

    if (json) {
        console.log(JSON.stringify({
            query,
            count: results.length,
            results: results.map(r => ({
                title: r.title || null,
                file_path: r.file_path,
                line_number: r.line_number,
                snippet: r.preview ? r.preview.replace(/\n/g, ' ').slice(0, 200) : null,
                score: r.score ?? null,
            })),
        }, null, 2));
        return;
    }

    console.log(`Searching for: "${query}"\n`);

    if (results.length === 0) {
        console.log('No results found.');
        return;
    }

    console.log(`Found ${results.length} result(s):\n`);

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const score = result.score ? ` (score: ${result.score.toFixed(2)})` : '';
        const title = result.title || result.file_path;
        const link = vscodeLinkAt(result.file_path, result.line_number);
        console.log(`  ${String(i + 1).padStart(2)}. ${title}${score}`);
        console.log(`      ${link}`);

        if (result.preview) {
            const snippet = result.preview.replace(/\n/g, ' ').slice(0, 120);
            console.log(`      "${snippet}..."`);
        }
        console.log();
    }
}

async function searchSemantic(db: ScimaxDbCore, query: string, limit: number, json: boolean): Promise<void> {
    if (!db.isVectorSearchAvailable()) {
        const stats = await db.getStats();
        if (!stats.has_embeddings) {
            console.error('Semantic search requires embeddings.');
            console.error('Configure scimax.db.embeddingProvider in VS Code settings, then run: scimax db rebuild');
        } else {
            console.error('Semantic search requires an Ollama embedding service.');
            console.error('Set scimax.db.embeddingProvider to "ollama" in VS Code settings.');
        }
        process.exit(1);
    }

    const results = await db.searchSemantic(query, { limit });

    if (json) {
        console.log(JSON.stringify({
            query,
            type: 'semantic',
            count: results.length,
            results: results.map(r => ({
                title: r.title || null,
                file_path: r.file_path,
                line_number: r.line_number,
                snippet: r.preview ? r.preview.replace(/\n/g, ' ').slice(0, 200) : null,
                score: r.score ?? null,
            })),
        }, null, 2));
        return;
    }

    console.log(`Semantic search for: "${query}"\n`);

    if (results.length === 0) {
        console.log('No results found.');
        return;
    }

    console.log(`Found ${results.length} result(s):\n`);

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const score = result.score ? ` (score: ${result.score.toFixed(4)})` : '';
        const title = result.title || result.file_path;
        const link = vscodeLinkAt(result.file_path, result.line_number);
        console.log(`  ${String(i + 1).padStart(2)}. ${title}${score}`);
        console.log(`      ${link}`);

        if (result.preview) {
            const snippet = result.preview.replace(/\n/g, ' ').slice(0, 120);
            console.log(`      "${snippet}..."`);
        }
        console.log();
    }
}
