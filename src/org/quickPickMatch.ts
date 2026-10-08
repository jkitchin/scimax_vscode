/**
 * Which quick-pick items a typed filter leaves, for pickers that need to act
 * on the result. VS Code does not expose its filtered list, and a multi-select
 * picker does not highlight a match as you type, so "Enter takes the one match
 * left" has to work out the matches itself.
 */

interface Matchable {
    label: string;
    description?: string;
    detail?: string;
}

function fields(item: Matchable): string[] {
    return [item.label, item.description ?? '', item.detail ?? ''].map(f => f.toLowerCase());
}

/** True if the characters of `query` appear in `text` in order. */
function isSubsequence(query: string, text: string): boolean {
    let i = 0;
    for (const ch of text) {
        if (ch === query[i]) i++;
        if (i === query.length) return true;
    }
    return false;
}

/**
 * The one item the filter leaves, if exactly one is left. Substring matches
 * count first, as VS Code ranks them first; only when there are none do looser
 * in-order (fuzzy) matches count.
 */
export function soleMatch<T extends Matchable>(items: T[], value: string): T | undefined {
    const query = value.trim().toLowerCase();
    if (!query) return undefined;

    const substring = items.filter(item => fields(item).some(f => f.includes(query)));
    if (substring.length) return substring.length === 1 ? substring[0] : undefined;

    const compact = query.replace(/\s+/g, '');
    const fuzzy = items.filter(item => fields(item).some(f => isSubsequence(compact, f)));
    return fuzzy.length === 1 ? fuzzy[0] : undefined;
}
