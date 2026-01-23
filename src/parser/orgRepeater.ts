/**
 * Pure functions for org-mode repeating task handling
 * No VS Code dependencies - can be used in tests
 */

/**
 * Pattern to match DEADLINE or SCHEDULED with repeater timestamp
 * Groups: 1=indent, 2=keyword, 3=year, 4=month, 5=day, 6=hour, 7=minute, 8=repeater
 */
export const REPEATER_TIMESTAMP_PATTERN = /^(\s*)(DEADLINE|SCHEDULED):\s*<(\d{4})-(\d{2})-(\d{2})(?:\s+\w{2,3})?(?:\s+(\d{2}):(\d{2}))?(?:\s+([\.\+]+\d+[hdwmy]))\s*>/;

/**
 * Day of week abbreviations
 */
const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Get day of week abbreviation for a date
 */
export function getDayOfWeek(date: Date): string {
    return DAYS_OF_WEEK[date.getDay()];
}

/**
 * Parse a repeater string into components
 * @param repeater - Repeater string like +1w, .+1d, ++1m
 * @returns Parsed components or null if invalid
 */
export function parseRepeaterString(repeater: string): { type: string; value: number; unit: string } | null {
    const match = repeater.match(/^([\.\+]+)(\d+)([hdwmy])$/);
    if (!match) return null;
    return {
        type: match[1],
        value: parseInt(match[2]),
        unit: match[3]
    };
}

/**
 * Advance a date by the repeater interval
 *
 * Repeater types:
 * - +Nd/w/m/y: shift from the original date
 * - .+Nd/w/m/y: shift from today
 * - ++Nd/w/m/y: shift to next future occurrence
 *
 * @param year - Original year
 * @param month - Original month (1-12)
 * @param day - Original day
 * @param repeater - Repeater string like +1w
 * @returns New date after applying the repeater
 */
export function advanceDateByRepeater(
    year: number,
    month: number,
    day: number,
    repeater: string
): Date {
    const repMatch = repeater.match(/^([\.\+]+)(\d+)([hdwmy])$/);
    if (!repMatch) {
        return new Date(year, month - 1, day);
    }

    const [, repType, valueStr, unit] = repMatch;
    const value = parseInt(valueStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let date: Date;

    if (repType === '.+') {
        // .+ means shift from today
        date = new Date(today);
    } else {
        // + or ++ means shift from the original date
        date = new Date(year, month - 1, day);
    }

    // Apply the shift
    applyShift(date, value, unit);

    // For ++ type, keep shifting until we're in the future
    if (repType === '++') {
        while (date <= today) {
            applyShift(date, value, unit);
        }
    }

    return date;
}

/**
 * Apply a time shift to a date (mutates the date)
 */
function applyShift(date: Date, value: number, unit: string): void {
    switch (unit) {
        case 'h':
            date.setHours(date.getHours() + value);
            break;
        case 'd':
            date.setDate(date.getDate() + value);
            break;
        case 'w':
            date.setDate(date.getDate() + value * 7);
            break;
        case 'm':
            date.setMonth(date.getMonth() + value);
            break;
        case 'y':
            date.setFullYear(date.getFullYear() + value);
            break;
    }
}

/**
 * Result from finding a repeater timestamp
 */
export interface RepeaterMatch {
    lineIndex: number;
    match: RegExpMatchArray;
    type: 'DEADLINE' | 'SCHEDULED';
}

/**
 * Find repeater timestamp in an array of lines
 *
 * @param lines - Array of lines to search
 * @param headingLineIndex - Index of the heading line
 * @returns Match info or null if no repeater found
 */
export function findRepeaterInLines(
    lines: string[],
    headingLineIndex: number
): RepeaterMatch | null {
    // DEADLINE/SCHEDULED must be on the line immediately after the heading
    const nextLineIndex = headingLineIndex + 1;
    if (nextLineIndex >= lines.length) return null;

    const lineText = lines[nextLineIndex];
    const match = lineText.match(REPEATER_TIMESTAMP_PATTERN);
    if (match) {
        return {
            lineIndex: nextLineIndex,
            match,
            type: match[2] as 'DEADLINE' | 'SCHEDULED'
        };
    }

    return null;
}

/**
 * Format a date as an org timestamp string
 *
 * @param date - Date to format
 * @param options - Formatting options
 * @returns Formatted timestamp like <2026-01-19 Mon>
 */
export function formatOrgTimestamp(
    date: Date,
    options: {
        hour?: number;
        minute?: number;
        repeater?: string;
        active?: boolean;
    } = {}
): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dow = getDayOfWeek(date);

    const open = options.active !== false ? '<' : '[';
    const close = options.active !== false ? '>' : ']';

    let result = `${open}${year}-${month}-${day} ${dow}`;

    if (options.hour !== undefined && options.minute !== undefined) {
        result += ` ${String(options.hour).padStart(2, '0')}:${String(options.minute).padStart(2, '0')}`;
    }

    if (options.repeater) {
        result += ` ${options.repeater}`;
    }

    result += close;
    return result;
}

/**
 * Extract date components from a REPEATER_TIMESTAMP_PATTERN match
 */
export function extractDateFromMatch(match: RegExpMatchArray): {
    indent: string;
    keyword: 'DEADLINE' | 'SCHEDULED';
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    repeater: string;
} {
    return {
        indent: match[1],
        keyword: match[2] as 'DEADLINE' | 'SCHEDULED',
        year: parseInt(match[3]),
        month: parseInt(match[4]),
        day: parseInt(match[5]),
        hour: match[6] ? parseInt(match[6]) : undefined,
        minute: match[7] ? parseInt(match[7]) : undefined,
        repeater: match[8]
    };
}
