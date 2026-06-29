/**
 * Test harness for the org TextMate grammar (syntaxes/org.tmLanguage.json).
 *
 * VS Code highlights org files with this grammar via the same `vscode-textmate`
 * + `vscode-oniguruma` engine VS Code itself uses, so tokenizing here reproduces
 * the editor's fontification faithfully. This lets us assert on real token scopes
 * and catch regressions (e.g. an unclosed `~`/`=` running away across lines).
 *
 * This file is intentionally NOT named *.test.ts so vitest does not execute it
 * as a suite; it is imported by the grammar test files.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as oniguruma from 'vscode-oniguruma';
import * as vsctm from 'vscode-textmate';

const GRAMMAR_PATH = path.resolve(__dirname, '../../../syntaxes/org.tmLanguage.json');
const SCOPE_NAME = 'source.org';

let registryPromise: Promise<vsctm.IGrammar | null> | undefined;

function loadGrammar(): Promise<vsctm.IGrammar | null> {
    if (!registryPromise) {
        // onig.wasm ships next to vscode-oniguruma's entry (release/main.js).
        const wasmPath = path.join(path.dirname(require.resolve('vscode-oniguruma')), 'onig.wasm');
        const wasmBin = fs.readFileSync(wasmPath).buffer;
        const onigLib = oniguruma.loadWASM(wasmBin).then(() => ({
            createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
            createOnigString: (s: string) => new oniguruma.OnigString(s),
        }));

        const registry = new vsctm.Registry({
            onigLib,
            loadGrammar: async (scopeName: string) => {
                if (scopeName === SCOPE_NAME) {
                    const data = fs.readFileSync(GRAMMAR_PATH, 'utf8');
                    return vsctm.parseRawGrammar(data, GRAMMAR_PATH);
                }
                return null;
            },
        });
        registryPromise = registry.loadGrammar(SCOPE_NAME);
    }
    return registryPromise;
}

export interface OrgToken {
    line: number;       // 0-indexed line within the input
    text: string;       // the token's source text
    scopes: string[];   // TextMate scopes (excluding the root source.org)
}

/**
 * Tokenize org source, carrying rule state across lines (so multi-line
 * constructs are modeled exactly as VS Code does). Returns a flat list of
 * tokens with their text and scopes.
 */
export async function tokenizeOrg(source: string): Promise<OrgToken[]> {
    const grammar = await loadGrammar();
    if (!grammar) {
        throw new Error('Failed to load org grammar');
    }
    const lines = source.split('\n');
    const out: OrgToken[] = [];
    let ruleStack: vsctm.StateStack = vsctm.INITIAL;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const result = grammar.tokenizeLine(line, ruleStack);
        for (const t of result.tokens) {
            out.push({
                line: i,
                text: line.substring(t.startIndex, t.endIndex),
                scopes: t.scopes.filter(s => s !== SCOPE_NAME),
            });
        }
        ruleStack = result.ruleStack;
    }
    return out;
}

/** True if any token whose text contains `needle` carries a scope matching `scopeRe`. */
export function hasScopeFor(tokens: OrgToken[], needle: string, scopeRe: RegExp): boolean {
    return tokens.some(t => t.text.includes(needle) && t.scopes.some(s => scopeRe.test(s)));
}

/** Collect the distinct markup scopes applied to tokens whose text includes `needle`. */
export function markupScopesFor(tokens: OrgToken[], needle: string): string[] {
    const set = new Set<string>();
    for (const t of tokens) {
        if (!t.text.includes(needle)) { continue; }
        for (const s of t.scopes) {
            if (/markup/.test(s)) { set.add(s); }
        }
    }
    return [...set];
}
