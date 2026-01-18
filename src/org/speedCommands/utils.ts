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
