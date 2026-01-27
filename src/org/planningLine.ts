/**
 * Planning line utilities for org-mode
 * Handles CLOSED, DEADLINE, and SCHEDULED timestamps on the same line
 */

/**
 * Find the planning line (CLOSED, DEADLINE, or SCHEDULED) for a heading.
 * In org-mode, all planning keywords should be on a single line after the heading.
 * Returns the line index relative to the lines array, or -1 if not found.
 * @param lines Array of lines starting from the heading
 * @param headingIndex Index of the heading in the lines array
 */
export function findPlanningLine(lines: string[], headingIndex: number): number {
    // Planning line must be immediately after the heading
    const nextLineIndex = headingIndex + 1;
    if (nextLineIndex >= lines.length) {
        return -1;
    }

    const nextLine = lines[nextLineIndex];

    // Check if it's a planning line (CLOSED, DEADLINE, or SCHEDULED)
    if (nextLine.match(/^\s*(CLOSED|DEADLINE|SCHEDULED):/)) {
        return nextLineIndex;
    }

    return -1;
}

/**
 * Build a planning line with CLOSED prepended or updated.
 * @param existingLine The existing planning line (may or may not have CLOSED)
 * @param closedTimestamp The CLOSED timestamp to add (e.g., "[2026-01-27 Tue 14:00]")
 * @returns The new planning line with CLOSED at the front
 */
export function buildPlanningLine(existingLine: string, closedTimestamp: string): string {
    // Extract indentation
    const indentMatch = existingLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    // Remove existing CLOSED if present
    let lineWithoutClosed = existingLine.replace(/^\s*CLOSED:\s*\[[^\]]*\]\s*/, '');
    // Also try removing CLOSED from the middle (shouldn't happen but just in case)
    lineWithoutClosed = lineWithoutClosed.replace(/\s*CLOSED:\s*\[[^\]]*\]/, '');

    // Trim the line without closed (removes leading/trailing whitespace)
    const trimmedRest = lineWithoutClosed.trim();

    if (trimmedRest) {
        return `${indent}CLOSED: ${closedTimestamp} ${trimmedRest}`;
    } else {
        return `${indent}CLOSED: ${closedTimestamp}`;
    }
}

/**
 * Remove CLOSED from a planning line, keeping other planning keywords.
 * @param line The planning line
 * @returns The line without CLOSED, or empty string if CLOSED was the only content
 */
export function removeClosed(line: string): string {
    // Extract indentation
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    // Remove CLOSED and its timestamp
    let result = line.replace(/^\s*CLOSED:\s*\[[^\]]*\]\s*/, '');
    result = result.replace(/\s*CLOSED:\s*\[[^\]]*\]/, '');

    const trimmed = result.trim();
    if (trimmed) {
        return indent + trimmed;
    }
    return '';
}
