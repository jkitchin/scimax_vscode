/**
 * Tag parsing for agenda items.
 *
 * Kept free of vscode imports so it can be unit tested directly.
 */

/**
 * Parse a heading's tags as stored in the database.
 *
 * The indexer writes tags with JSON.stringify (see scimaxDbCore), so the stored
 * form is `["work","urgent"]` — not a comma-separated list. Splitting on commas
 * yields a single bogus tag like `["work"` and renders as `:[]:` in the agenda.
 * Fall back to comma-splitting for rows written before the JSON format, and for
 * defensive tolerance of hand-edited databases.
 */
export function parseHeadingTags(raw: string | null | undefined): string[] {
    if (!raw) return [];

    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '[]') return [];

    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed
                    .filter((t): t is string => typeof t === 'string')
                    .map(t => t.trim())
                    .filter(t => t.length > 0);
            }
        } catch {
            // Malformed JSON: fall through to the legacy path rather than
            // dropping the tags entirely.
        }
    }

    return trimmed.split(',').map(t => t.trim()).filter(t => t.length > 0);
}
