/**
 * Determine which component of the timestamp the cursor is on.
 *
 * A cursor directly after a field (e.g. between "10" and "-" in
 * 2026-10-19) counts as on that field, matching Emacs org-pos-in-match-range.
 */
export function getTimestampComponent(
    line: string,
    cursorCol: number,
    ts: { start: number; end: number; hour?: number; repeater?: string }
): 'year' | 'month' | 'day' | 'hour' | 'minute' | 'repeater' {
    const text = line.substring(ts.start, ts.end);
    const relativePos = cursorCol - ts.start;

    // Find positions of each component in the timestamp
    // Format: <YYYY-MM-DD Day HH:MM +1w>
    const yearMatch = text.match(/(\d{4})/);
    const monthMatch = text.match(/\d{4}-(\d{2})/);
    const dayMatch = text.match(/\d{4}-\d{2}-(\d{2})/);
    const timeMatch = text.match(/(\d{2}):(\d{2})/);
    const repeaterMatch = text.match(/([.+]+\d+[hdwmy])/);

    if (yearMatch && relativePos >= yearMatch.index! && relativePos <= yearMatch.index! + 4) {
        return 'year';
    }
    if (monthMatch && relativePos >= text.indexOf('-') + 1 && relativePos <= text.indexOf('-') + 3) {
        return 'month';
    }
    if (dayMatch) {
        const secondDash = text.indexOf('-', text.indexOf('-') + 1);
        if (relativePos >= secondDash + 1 && relativePos <= secondDash + 3) {
            return 'day';
        }
    }
    if (timeMatch && ts.hour !== undefined) {
        const timeStart = text.indexOf(timeMatch[0]);
        if (relativePos >= timeStart && relativePos <= timeStart + 2) {
            return 'hour';
        }
        if (relativePos >= timeStart + 3 && relativePos <= timeStart + 5) {
            return 'minute';
        }
    }
    if (repeaterMatch && ts.repeater) {
        const repStart = text.indexOf(repeaterMatch[0]);
        if (relativePos >= repStart) {
            return 'repeater';
        }
    }

    // Default to day
    return 'day';
}
