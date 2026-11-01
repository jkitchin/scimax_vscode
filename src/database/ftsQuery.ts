/**
 * Make typed text safe to pass to FTS5 MATCH.
 *
 * FTS5 has its own query language, and a bare word may only contain letters,
 * digits, `_` and non-ASCII characters. Anything else is syntax: in
 * `kitchin-2025-beyon-fourt` the `-` and `:` characters make SQLite report
 * "no such column: 2025" or "fts5: syntax error". Words with such characters
 * are quoted as phrases here, which the tokenizer splits the same way it
 * split the indexed text, so `"kitchin-2025-beyon-fourt"` matches those four
 * tokens in a row.
 *
 * The documented query syntax keeps working: AND / OR / NOT, NEAR(...),
 * "quoted phrases", prefix*, ^initial tokens, parentheses and column filters
 * on the table's columns (title:word).
 */

const OPERATORS = new Set(['AND', 'OR', 'NOT', 'NEAR']);
const COLUMNS = new Set(['file_path', 'title', 'content']);
// Letters, digits, `_` and non-ASCII: what FTS5 accepts in a bareword.
const BAREWORD = /^[\p{L}\p{N}_\u0080-￿]+$/u;

function quote(text: string): string {
    return `"${text.replace(/"/g, '""')}"`;
}

function normalizeWord(word: string): string {
    if (OPERATORS.has(word)) return word;
    if (/^\d+$/.test(word)) return word;  // NEAR(a b, 5) distance

    let prefix = '';
    let rest = word;
    const col = /^([A-Za-z_]+):(.+)$/.exec(rest);
    if (col && COLUMNS.has(col[1])) {
        prefix = `${col[1]}:`;
        rest = col[2];
    }
    if (rest.startsWith('^')) {
        prefix += '^';
        rest = rest.slice(1);
    }
    let star = '';
    if (rest.endsWith('*')) {
        star = '*';
        rest = rest.slice(0, -1);
    }
    if (!rest) return quote(word);
    return prefix + (BAREWORD.test(rest) ? rest : quote(rest)) + star;
}

/**
 * Every word of the input as a quoted phrase, with no operators: the
 * fallback when FTS5 still rejects a normalized query.
 */
export function literalFtsQuery(input: string): string {
    return input.split(/\s+/).filter(Boolean).map(quote).join(' ');
}

export function normalizeFtsQuery(input: string): string {
    const out: string[] = [];
    // Quoted phrases, parentheses, commas, then runs of anything else.
    const tokenRe = /"(?:[^"]|"")*"?|[(),]|[^\s(),"]+/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(input)) !== null) {
        const tok = m[0];
        if (tok.startsWith('"')) {
            // Close an unterminated phrase rather than send a syntax error.
            out.push(/^"(?:[^"]|"")*"$/.test(tok) ? tok : `${tok}"`);
        } else if (tok === '(' || tok === ')' || tok === ',') {
            out.push(tok);
        } else if (/^[A-Za-z_]+:$/.test(tok) && COLUMNS.has(tok.slice(0, -1))) {
            // `title: word` (as documented) is the column filter `title:word`.
            out.push(tok);
        } else {
            const word = normalizeWord(tok);
            const prev = out[out.length - 1];
            if (prev && /^[A-Za-z_]+:$/.test(prev) && !OPERATORS.has(word)) out[out.length - 1] = prev + word;
            else out.push(word);
        }
    }
    // A column name with nothing after it is just a word.
    for (let i = 0; i < out.length; i++) {
        if (/^[A-Za-z_]+:$/.test(out[i]) && out[i + 1] !== '(') out[i] = out[i].slice(0, -1);
    }
    // Half-typed input (search runs as you type): balance parentheses and
    // drop operators with nothing after them.
    const balanced: string[] = [];
    let depth = 0;
    for (const tok of out) {
        if (tok === ')') {
            if (depth === 0) continue;
            depth--;
        } else if (tok === '(') {
            depth++;
        }
        balanced.push(tok);
    }
    while (balanced.length && (OPERATORS.has(balanced[balanced.length - 1]) || balanced[balanced.length - 1] === ',' || balanced[balanced.length - 1] === '(')) {
        if (balanced.pop() === '(') depth--;
    }
    while (balanced.length && (balanced[0] === 'AND' || balanced[0] === 'OR')) balanced.shift();
    for (; depth > 0; depth--) balanced.push(')');

    // Drop whitespace before ')' and ',' (NEAR(a b, 5)) for readability.
    return balanced.join(' ').replace(/\( /g, '(').replace(/ ([),])/g, '$1').replace(/\bNEAR \(/g, 'NEAR(').replace(/: \(/g, ':(');
}
