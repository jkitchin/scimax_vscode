/**
 * Shared utilities for speed commands
 */

/**
 * Extract tags from a heading line
 * Tags are in format :tag1:tag2:tag3: at the end of the line
 */
export function extractTags(line: string): string[] {
    const match = line.match(/:([A-Za-z0-9_@#%:]+):\s*$/);
    if (!match) return [];
    return match[1].split(':').filter(t => t.length > 0);
}

/**
 * Format tags for insertion into heading
 */
export function formatTags(tags: string[]): string {
    if (tags.length === 0) return '';
    return `:${tags.join(':')}:`;
}

/** Edit distance, used to flag near-duplicate tags such as groupmeeting/groupmeetings. */
function editDistance(a: string, b: string): number {
    const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = prev[j];
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
            diag = tmp;
        }
    }
    return prev[b.length];
}

/** Existing tags that look like a misspelling or plural of `tag`. */
export function similarTags(tag: string, existing: string[]): string[] {
    const t = tag.toLowerCase();
    return existing.filter(e => {
        const x = e.toLowerCase();
        if (x === t) return e !== tag; // differs only by case
        const maxDist = Math.min(t.length, x.length) <= 4 ? 1 : 2;
        return editDistance(t, x) <= maxDist;
    });
}

/**
 * Remove tags from the end of a heading line
 */
export function removeTagsFromLine(line: string): string {
    return line.replace(/\s*:[A-Za-z0-9_@#%:]+:\s*$/, '').trimEnd();
}

/**
 * Check if a heading has a specific tag (case-insensitive)
 */
export function hasTag(line: string, tag: string): boolean {
    const tags = extractTags(line);
    return tags.some(t => t.toUpperCase() === tag.toUpperCase());
}

/**
 * Add or remove a tag from a heading line
 */
export function toggleTag(line: string, tag: string): { newLine: string; added: boolean } {
    const tags = extractTags(line);
    const tagUpper = tag.toUpperCase();
    const hasTagAlready = tags.some(t => t.toUpperCase() === tagUpper);

    // Remove existing tags from line
    let newLine = removeTagsFromLine(line);

    let newTags: string[];
    if (hasTagAlready) {
        // Remove the tag
        newTags = tags.filter(t => t.toUpperCase() !== tagUpper);
    } else {
        // Add the tag
        newTags = [...tags, tag];
    }

    if (newTags.length > 0) {
        newLine = newLine + ' ' + formatTags(newTags);
    }

    return { newLine, added: !hasTagAlready };
}
