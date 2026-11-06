/**
 * Command-line argument parsing for the scimax CLI.
 */

export interface ParsedCliArgs {
    command: string;
    subcommand?: string;
    args: string[];
    flags: Record<string, string | boolean>;
    passthrough: string[];
}

/**
 * A value that starts with a dash but is not an option: a negative number or
 * a relative date such as -1d, -2w, -3m.
 */
const NEGATIVE_VALUE = /^-\d/;

const isOption = (arg: string | undefined): boolean =>
    !!arg && arg.startsWith('-') && !NEGATIVE_VALUE.test(arg);

/**
 * Parse command-line arguments into structured format.
 *
 *   --key value, --key=value, -k value  set a flag to a value
 *   --key, -k (before another option)   set a flag to true
 *   -1d, -5                             values, not options
 *   --                                  everything after it is passed through
 */
export function parseArgs(argv: string[]): ParsedCliArgs {
    // Everything after `--` is left as is, for commands that hand it on (marp)
    const dashes = argv.indexOf('--');
    const args = dashes >= 0 ? argv.slice(0, dashes) : argv;
    const passthrough = dashes >= 0 ? argv.slice(dashes + 1) : [];
    const flags: Record<string, string | boolean> = {};
    const positional: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!isOption(arg)) {
            positional.push(arg);
        } else if (arg.startsWith('--') && arg.includes('=')) {
            const eq = arg.indexOf('=');
            flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        } else if (arg.startsWith('--') || arg.length === 2) {
            const key = arg.slice(arg.startsWith('--') ? 2 : 1);
            const next = args[i + 1];
            if (next !== undefined && !isOption(next)) {
                flags[key] = next;
                i++;
            } else {
                flags[key] = true;
            }
        } else {
            flags[arg.slice(1)] = true;
        }
    }

    return {
        command: positional[0] || 'help',
        subcommand: positional[1],
        args: positional.slice(1),
        flags,
        passthrough,
    };
}
