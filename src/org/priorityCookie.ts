/**
 * Pure helpers for heading priority cookies (`[#A]`), shared by the
 * Shift+Up/Down handlers. Kept free of vscode so they can be unit tested.
 */

/**
 * Check if line is an org heading and return match info
 * @param line The line text to check
 * @param validTodoStates Optional set of valid TODO states for the document
 */
export function getOrgHeadingInfo(line: string, validTodoStates?: Set<string>, markdown = false): { level: number; todoState: string; rest: string } | null {
    // First check if it's a heading at all. A markdown keyword may be written
    // `[TODO]`; it is read (and rewritten) in the bare form.
    const headingMatch = markdown
        ? line.replace(/^(#{1,6}\s+)\[([A-Z][A-Z0-9_-]*)\](?=\s|$)/, '$1$2').match(/^(#{1,6})\s+(.*)$/)
        : line.match(/^(\*+)\s+(.*)$/);
    if (!headingMatch) return null;

    const stars = headingMatch[1];
    const afterStars = headingMatch[2];

    // If we have valid states, check for any of them
    if (validTodoStates && validTodoStates.size > 0) {
        // Build regex pattern from valid states (escape special regex chars)
        const escapedStates = Array.from(validTodoStates)
            .filter(s => s.length > 0)
            .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

        if (escapedStates.length > 0) {
            const statesPattern = new RegExp(`^(${escapedStates.join('|')})\\s+(.*)$`);
            const stateMatch = afterStars.match(statesPattern);
            if (stateMatch) {
                return {
                    level: stars.length,
                    todoState: stateMatch[1],
                    rest: stateMatch[2]
                };
            }
        }
    }

    // Fallback: check for common TODO/DONE states
    const defaultMatch = afterStars.match(/^(TODO|DONE|NEXT|WAIT|WAITING|HOLD|SOMEDAY|CANCELLED|CANCELED|IN-PROGRESS)\s+(.*)$/);
    if (defaultMatch) {
        return {
            level: stars.length,
            todoState: defaultMatch[1],
            rest: defaultMatch[2]
        };
    }

    // No TODO state found
    return {
        level: stars.length,
        todoState: '',
        rest: afterStars
    };
}

/**
 * Cycle priority up (increase priority): C → B → A → (none) → C
 * In org-mode, A is highest priority, C is lowest
 */
function cyclePriorityUp(current: string): string {
    // Order for increasing priority: '' -> A -> B -> C -> ''
    // Wait, that's decreasing. Let me think again:
    // Up = increase = higher priority = A is higher than B is higher than C
    // So: C -> B -> A -> '' -> C
    const upOrder = ['C', 'B', 'A', ''];
    const idx = upOrder.indexOf(current);
    if (idx === -1) return 'A'; // Unknown, start with A (highest)
    return upOrder[(idx + 1) % upOrder.length];
}

/**
 * Cycle priority down (decrease priority): A → B → C → (none) → A
 */
function cyclePriorityDown(current: string): string {
    // Order for decreasing priority: A -> B -> C -> '' -> A
    const downOrder = ['A', 'B', 'C', ''];
    const idx = downOrder.indexOf(current);
    if (idx === -1) return 'C'; // Unknown, start with C (lowest)
    return downOrder[(idx + 1) % downOrder.length];
}

/**
 * The edit that cycles a heading's priority cookie: `[#A]` right after the
 * stars (`*` in org, `#` in Markdown) and the TODO keyword, if any (any
 * keyword of the document's workflow, e.g. from #+TODO:). Returns null when
 * the line is not a heading. Pure, for testing.
 */
export function priorityCycleEdit(
    line: string,
    markdown: boolean,
    validTodoStates: Set<string>,
    direction: 'up' | 'down'
): { start: number; end: number; text: string } | null {
    const info = getOrgHeadingInfo(line, validTodoStates, markdown);
    if (!info) return null;
    // `rest` is a suffix of the line: the title, after the stars and keyword
    const at = line.length - info.rest.length;
    const cookie = info.rest.match(/^\[#([A-Z0-9])\]( ?)/);
    const current = cookie ? cookie[1] : '';
    const next = direction === 'up' ? cyclePriorityUp(current) : cyclePriorityDown(current);
    if (!cookie) {
        return { start: at, end: at, text: `[#${next}] ` };
    }
    if (next === '') {
        return { start: at, end: at + cookie[0].length, text: '' };
    }
    return { start: at, end: at + 4, text: `[#${next}]` };
}
