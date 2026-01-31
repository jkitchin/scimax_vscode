/**
 * Date Parser Utility
 *
 * Parses natural language date expressions into Date objects.
 * Supports relative dates (+2d, -1w), day names (monday),
 * month names (jan 15), and ISO format (2026-01-15).
 */

/**
 * Parse a natural language date expression into a Date object.
 *
 * Supported expressions:
 * - Named: today, tomorrow, yesterday, next week, next month, next year
 * - Day names: monday, mon, tuesday, tue, etc. (next occurrence)
 * - Next day: next monday, next friday, etc. (the week after this week's occurrence)
 * - This day: this monday, this friday, etc. (this week's occurrence)
 * - Relative: +2d, -1w, +3m, +1y (days, weeks, months, years)
 * - Month + day: jan 15, 15 jan, december 25
 * - ISO format: 2026-01-15
 *
 * @param input The date expression to parse
 * @returns The parsed Date or null if invalid
 */
export function parseRelativeDate(input: string): Date | null {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const trimmed = input.trim().toLowerCase();

    // Day name lookup for reuse
    const dayNames: { [key: string]: number } = {
        'sun': 0, 'sunday': 0,
        'mon': 1, 'monday': 1,
        'tue': 2, 'tues': 2, 'tuesday': 2,
        'wed': 3, 'wednesday': 3,
        'thu': 4, 'thur': 4, 'thurs': 4, 'thursday': 4,
        'fri': 5, 'friday': 5,
        'sat': 6, 'saturday': 6
    };

    // Named expressions
    if (trimmed === 'today') return today;
    if (trimmed === 'tomorrow') {
        const d = new Date(today);
        d.setDate(d.getDate() + 1);
        return d;
    }
    if (trimmed === 'yesterday') {
        const d = new Date(today);
        d.setDate(d.getDate() - 1);
        return d;
    }
    if (trimmed === 'next week') {
        const d = new Date(today);
        d.setDate(d.getDate() + 7);
        return d;
    }
    if (trimmed === 'next month') {
        const d = new Date(today);
        d.setMonth(d.getMonth() + 1);
        return d;
    }
    if (trimmed === 'next year') {
        const d = new Date(today);
        d.setFullYear(d.getFullYear() + 1);
        return d;
    }

    // "next <day>" expressions: "next friday", "next mon", etc.
    const nextDayMatch = trimmed.match(/^next\s+(\w+)$/);
    if (nextDayMatch) {
        const dayName = nextDayMatch[1];
        if (dayNames[dayName] !== undefined) {
            const targetDay = dayNames[dayName];
            const currentDay = today.getDay();
            // Always go to next week's occurrence (7-13 days from now)
            let daysUntil = targetDay - currentDay;
            if (daysUntil <= 0) {
                daysUntil += 7;
            }
            // "next friday" means the friday after "this friday"
            // so add 7 more days if it's this week's occurrence
            daysUntil += 7;
            const d = new Date(today);
            d.setDate(d.getDate() + daysUntil);
            return d;
        }
    }

    // "this <day>" expressions: "this friday", "this mon", etc.
    const thisDayMatch = trimmed.match(/^this\s+(\w+)$/);
    if (thisDayMatch) {
        const dayName = thisDayMatch[1];
        if (dayNames[dayName] !== undefined) {
            const targetDay = dayNames[dayName];
            const currentDay = today.getDay();
            let daysUntil = targetDay - currentDay;
            // "this friday" means this week's friday, even if it's today
            if (daysUntil < 0) {
                daysUntil += 7; // If past, go to next week (graceful fallback)
            }
            const d = new Date(today);
            d.setDate(d.getDate() + daysUntil);
            return d;
        }
    }

    // Day names alone: monday, tuesday, etc. -> next occurrence of that day
    if (dayNames[trimmed] !== undefined) {
        const targetDay = dayNames[trimmed];
        const currentDay = today.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil <= 0) {
            daysUntil += 7; // Next week if today or past
        }
        const d = new Date(today);
        d.setDate(d.getDate() + daysUntil);
        return d;
    }

    // Relative expressions: +2d, +1w, +3m, -1d, etc.
    const relativeMatch = trimmed.match(/^([+-])?(\d+)([dwmy])$/);
    if (relativeMatch) {
        const sign = relativeMatch[1] === '-' ? -1 : 1;
        const amount = parseInt(relativeMatch[2], 10) * sign;
        const unit = relativeMatch[3];

        const d = new Date(today);
        switch (unit) {
            case 'd':
                d.setDate(d.getDate() + amount);
                break;
            case 'w':
                d.setDate(d.getDate() + amount * 7);
                break;
            case 'm':
                d.setMonth(d.getMonth() + amount);
                break;
            case 'y':
                d.setFullYear(d.getFullYear() + amount);
                break;
        }
        return d;
    }

    // Month name + day: "jan 20", "feb 15", "december 25"
    const monthNames: { [key: string]: number } = {
        'jan': 0, 'january': 0,
        'feb': 1, 'february': 1,
        'mar': 2, 'march': 2,
        'apr': 3, 'april': 3,
        'may': 4,
        'jun': 5, 'june': 5,
        'jul': 6, 'july': 6,
        'aug': 7, 'august': 7,
        'sep': 8, 'sept': 8, 'september': 8,
        'oct': 9, 'october': 9,
        'nov': 10, 'november': 10,
        'dec': 11, 'december': 11
    };

    const monthDayMatch = trimmed.match(/^([a-z]+)\s+(\d{1,2})$/);
    if (monthDayMatch) {
        const monthName = monthDayMatch[1];
        const day = parseInt(monthDayMatch[2], 10);
        const month = monthNames[monthName];

        if (month !== undefined && day >= 1 && day <= 31) {
            // Start with current year
            let year = today.getFullYear();
            let d = new Date(year, month, day);

            // If the date is in the past, use next year
            if (d < today) {
                d = new Date(year + 1, month, day);
            }
            return d;
        }
    }

    // Also support "20 jan" format
    const dayMonthMatch = trimmed.match(/^(\d{1,2})\s+([a-z]+)$/);
    if (dayMonthMatch) {
        const day = parseInt(dayMonthMatch[1], 10);
        const monthName = dayMonthMatch[2];
        const month = monthNames[monthName];

        if (month !== undefined && day >= 1 && day <= 31) {
            let year = today.getFullYear();
            let d = new Date(year, month, day);

            if (d < today) {
                d = new Date(year + 1, month, day);
            }
            return d;
        }
    }

    // YYYY-MM-DD format
    const dateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch) {
        const [, year, month, day] = dateMatch.map(Number);
        return new Date(year, month - 1, day);
    }

    return null;
}

/**
 * Get examples of supported date expressions for display in UI
 */
export function getDateExpressionExamples(): string {
    return 'Examples: today, tomorrow, friday, next friday, this monday, +2d, +1w, jan 15';
}
