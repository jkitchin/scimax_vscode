/**
 * Tangle command - extract source blocks from an org file to their :tangle targets
 *
 * Uses the same tangling engine as the VS Code extension for consistent behavior.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    extractSourceBlocks,
    tangleBlocks,
    TangleOptions,
} from '../../parser/orgBabelAdvanced';

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

export async function tangleCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const inputFile = args.args[0];
    const json = args.flags.json === true;

    if (!inputFile) {
        console.error('Usage: scimax tangle <file.org> [--only name1,name2] [--no-noweb] [--json]');
        process.exit(1);
    }

    const inputPath = path.resolve(inputFile);
    if (!fs.existsSync(inputPath)) {
        if (json) {
            console.log(JSON.stringify({ success: false, error: `File not found: ${inputPath}` }));
        } else {
            console.error(`File not found: ${inputPath}`);
        }
        process.exit(1);
    }

    const content = fs.readFileSync(inputPath, 'utf-8');
    const blocks = extractSourceBlocks(content);

    const onlyBlocks = typeof args.flags.only === 'string'
        ? args.flags.only.split(',').map(s => s.trim()).filter(s => s)
        : undefined;

    const options: TangleOptions = {
        baseDir: path.dirname(inputPath),
        mkdirp: true,
        noweb: args.flags['no-noweb'] !== true,
    };
    if (onlyBlocks && onlyBlocks.length > 0) {
        options.onlyBlocks = onlyBlocks;
    }

    const result = tangleBlocks(blocks, options);

    if (json) {
        console.log(JSON.stringify({
            success: result.errors.length === 0,
            input_file: inputPath,
            files: result.files,
            total_blocks: result.totalBlocks,
            errors: result.errors.map(e => ({
                block: e.block.name || `line ${e.block.lineNumber}`,
                error: e.error,
            })),
        }));
    } else {
        if (result.files.length === 0 && result.errors.length === 0) {
            console.log('No blocks with a :tangle target found.');
        } else {
            for (const f of result.files) {
                console.log(`Tangled ${f.blocks} block(s), ${f.lines} line(s) -> ${f.path}`);
            }
        }
        for (const e of result.errors) {
            console.error(`Error tangling ${e.block.name || `block at line ${e.block.lineNumber}`}: ${e.error}`);
        }
    }

    if (result.errors.length > 0) {
        process.exit(1);
    }
}
