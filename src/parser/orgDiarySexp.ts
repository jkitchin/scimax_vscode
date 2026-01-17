/**
 * Diary Sexp Evaluator
 *
 * Evaluates Emacs-style diary S-expressions to determine if they match a given date.
 *
 * Supported functions:
 * - diary-anniversary: Annual events (birthdays, anniversaries)
 * - diary-float: Floating dates (e.g., "third Thursday of November")
 */

export interface DiarySexpResult {
    matches: boolean;
    /** For anniversary, the number of years since the event */
    years?: number;
    /** Description of what matched */
    description?: string;
}

/**
 * Parse a diary sexp string and extract the function name and arguments
 */
export function parseDiarySexp(sexp: string): { fn: string; args: (number | string | null)[] } | null {
    // Remove outer parentheses if present
    let inner = sexp.trim();
    if (inner.startsWith('(') && inner.endsWith(')')) {
        inner = inner.slice(1, -1).trim();
    }

    // Split into function name and arguments
    // Handle both space-separated and more complex expressions
    const parts = inner.split(/\s+/);
    if (parts.length === 0) return null;

    const fn = parts[0];
    const args: (number | string | null)[] = [];

    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        // Check for 't' (Emacs true/every)
        if (part === 't') {
            args.push(null); // null represents "any/every"
        } else if (/^-?\d+$/.test(part)) {
            args.push(parseInt(part, 10));
        } else {
            args.push(part);
        }
    }

    return { fn, args };
}

/**
 * Evaluate diary-anniversary
 *
 * Format: (diary-anniversary MONTH DAY YEAR)
 * Matches every year on the given month and day.
 *
 * @param month - Month (1-12)
 * @param day - Day of month
 * @param year - Original year of the event
 * @param checkDate - Date to check against
 */
export function diaryAnniversary(
    month: number,
    day: number,
    year: number,
    checkDate: Date
): DiarySexpResult {
    const checkMonth = checkDate.getMonth() + 1; // JavaScript months are 0-indexed
    const checkDay = checkDate.getDate();
    const checkYear = checkDate.getFullYear();

    if (checkMonth === month && checkDay === day) {
        const years = checkYear - year;
        return {
            matches: true,
            years,
            description: years === 0
                ? 'Today'
                : `${years} year${years === 1 ? '' : 's'} ago`
        };
    }

    return { matches: false };
}

/**
 * Evaluate diary-float
 *
 * Format: (diary-float MONTH DAYNAME N &optional DAY)
 * Matches floating dates like "third Thursday of November"
 *
 * @param month - Month (1-12) or null for every month
 * @param dayname - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
 * @param n - Which occurrence: 1=first, 2=second, ..., -1=last, -2=second-to-last
 * @param checkDate - Date to check against
 * @param day - Optional: specific day constraint (rarely used)
 */
export function diaryFloat(
    month: number | null,
    dayname: number,
    n: number,
    checkDate: Date,
    day?: number
): DiarySexpResult {
    const checkMonth = checkDate.getMonth() + 1;
    const checkDayOfWeek = checkDate.getDay();
    const checkDay = checkDate.getDate();
    const checkYear = checkDate.getFullYear();

    // Check month constraint (null means every month)
    if (month !== null && checkMonth !== month) {
        return { matches: false };
    }

    // Check day of week
    if (checkDayOfWeek !== dayname) {
        return { matches: false };
    }

    // Calculate which occurrence this is
    if (n > 0) {
        // Positive n: count from beginning of month
        // First occurrence is days 1-7, second is 8-14, etc.
        const occurrence = Math.ceil(checkDay / 7);
        if (occurrence !== n) {
            return { matches: false };
        }
    } else if (n < 0) {
        // Negative n: count from end of month
        // -1 = last, -2 = second-to-last, etc.
        const daysInMonth = new Date(checkYear, checkMonth, 0).getDate();
        const daysFromEnd = daysInMonth - checkDay;
        // Last occurrence: within 6 days of end
        // Second-to-last: 7-13 days from end, etc.
        const occurrenceFromEnd = Math.floor(daysFromEnd / 7) + 1;
        if (occurrenceFromEnd !== -n) {
            return { matches: false };
        }
    }

    // Optional day constraint
    if (day !== undefined && checkDay !== day) {
        return { matches: false };
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const ordinals = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];

    let description: string;
    if (n > 0) {
        const ordinal = ordinals[n] || `${n}th`;
        const monthStr = month !== null ? ` of ${monthNames[month]}` : '';
        description = `${ordinal} ${dayNames[dayname]}${monthStr}`;
    } else {
        const ordinal = n === -1 ? 'last' : `${-n}${-n === 2 ? 'nd' : -n === 3 ? 'rd' : 'th'}-to-last`;
        const monthStr = month !== null ? ` of ${monthNames[month]}` : '';
        description = `${ordinal} ${dayNames[dayname]}${monthStr}`;
    }

    return {
        matches: true,
        description
    };
}

/**
 * Evaluate a diary sexp against a date
 *
 * @param sexp - The sexp string (without the %% prefix)
 * @param checkDate - Date to check against
 */
export function evaluateDiarySexp(sexp: string, checkDate: Date): DiarySexpResult {
    const parsed = parseDiarySexp(sexp);
    if (!parsed) {
        return { matches: false, description: 'Invalid sexp' };
    }

    switch (parsed.fn) {
        case 'diary-anniversary': {
            const [month, day, year] = parsed.args;
            if (typeof month !== 'number' || typeof day !== 'number' || typeof year !== 'number') {
                return { matches: false, description: 'Invalid diary-anniversary arguments' };
            }
            return diaryAnniversary(month, day, year, checkDate);
        }

        case 'diary-float': {
            const [month, dayname, n, day] = parsed.args;
            if (typeof dayname !== 'number' || typeof n !== 'number') {
                return { matches: false, description: 'Invalid diary-float arguments' };
            }
            // month can be null (for every month) or a number
            const monthVal = month === null ? null : (typeof month === 'number' ? month : null);
            const dayVal = typeof day === 'number' ? day : undefined;
            return diaryFloat(monthVal, dayname, n, checkDate, dayVal);
        }

        default:
            return { matches: false, description: `Unsupported diary function: ${parsed.fn}` };
    }
}

/**
 * Get all dates in a range that match a diary sexp
 *
 * @param sexp - The sexp string
 * @param startDate - Start of date range
 * @param endDate - End of date range
 */
export function getDiarySexpDates(
    sexp: string,
    startDate: Date,
    endDate: Date
): { date: Date; result: DiarySexpResult }[] {
    const matches: { date: Date; result: DiarySexpResult }[] = [];

    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    while (current <= end) {
        const result = evaluateDiarySexp(sexp, current);
        if (result.matches) {
            matches.push({ date: new Date(current), result });
        }
        current.setDate(current.getDate() + 1);
    }

    return matches;
}
