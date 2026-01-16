/**
 * Search command - full-text and semantic search across org files
 */

import { createCliDatabase, CliDatabase, CliSearchResult } from '../database';

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
    const query = args.args[0];

    if (!query) {
        console.error('Usage: scimax search <query> [--semantic] [--limit N]');
        process.exit(1);
    }

    const db = await createCliDatabase(config.dbPath);
    const limit = typeof args.flags.limit === 'string' ? parseInt(args.flags.limit, 10) : 20;
    const semantic = args.flags.semantic === true;

    try {
        if (semantic) {
            await searchSemantic(db, query, limit);
        } else {
            await searchFullText(db, query, limit);
        }
    } finally {
        await db.close();
    }
}

async function searchFullText(db: CliDatabase, query: string, limit: number): Promise<void> {
    console.log(`Searching for: "${query}"\n`);

    const results = await db.search(query, { limit });

    if (results.length === 0) {
        console.log('No results found.');
        return;
    }

    console.log(`Found ${results.length} result(s):\n`);

    for (const result of results) {
        // Show heading with score
        const score = result.score ? ` (score: ${result.score.toFixed(2)})` : '';
        console.log(`${result.title}${score}`);
        console.log(`  ${result.file_path}:${result.line_number}`);

        // Show snippet if available
        if (result.snippet) {
            const snippet = result.snippet
                .replace(/\n/g, ' ')
                .slice(0, 120);
            console.log(`  "${snippet}..."`);
        }
        console.log();
    }
}

async function searchSemantic(db: CliDatabase, query: string, _limit: number): Promise<void> {
    console.log(`Semantic search for: "${query}"\n`);

    // Check if embeddings are available
    const hasEmbeddings = await db.hasEmbeddings();
    if (!hasEmbeddings) {
        console.error('Semantic search requires embeddings.');
        console.error('Configure an embedding service in VS Code settings first.');
        console.error('Then run: scimax db rebuild');
        process.exit(1);
    }

    // Note: Semantic search requires embedding the query, which needs an embedding service
    // For CLI, this would require additional configuration
    console.error('Semantic search from CLI not yet implemented.');
    console.error('Use VS Code for semantic search, or use text search: scimax search "query"');
    process.exit(1);
}
