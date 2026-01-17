/**
 * Diary Sexp Evaluator
 *
 * Evaluates Emacs-style diary S-expressions to determine if they match a given date.
 *
 * Supported functions:
 * - diary-anniversary: Annual events (birthdays, anniversaries)
 * - diary-float: Floating dates (e.g., "third Thursday of November")
 * - diary-cyclic: Repeating events every N days from a start date
 * - diary-block: Events between two dates (inclusive)
 * - diary-date: Specific date match
 * - org-class: Recurring class schedule (specific weekday between two dates)
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
 * Evaluate diary-cyclic
 *
 * Format: (diary-cyclic N MONTH DAY YEAR)
 * Matches every N days starting from the given date.
 *
 * @param n - Repeat interval in days
 * @param month - Start month (1-12)
 * @param day - Start day
 * @param year - Start year
 * @param checkDate - Date to check against
 */
export function diaryCyclic(
    n: number,
    month: number,
    day: number,
    year: number,
    checkDate: Date
): DiarySexpResult {
    const startDate = new Date(year, month - 1, day);
    startDate.setHours(0, 0, 0, 0);

    const checkDateNorm = new Date(checkDate);
    checkDateNorm.setHours(0, 0, 0, 0);

    // Check if the date is on or after the start date
    if (checkDateNorm < startDate) {
        return { matches: false };
    }

    // Calculate difference in days
    const diffMs = checkDateNorm.getTime() - startDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    // Check if it's a multiple of n days from start
    if (diffDays % n === 0) {
        const occurrences = diffDays / n;
        return {
            matches: true,
            description: occurrences === 0
                ? 'Start date'
                : `Every ${n} day${n === 1 ? '' : 's'} (occurrence ${occurrences + 1})`
        };
    }

    return { matches: false };
}

/**
 * Evaluate diary-block
 *
 * Format: (diary-block M1 D1 Y1 M2 D2 Y2)
 * Matches all dates between the two dates (inclusive).
 *
 * @param m1 - Start month (1-12)
 * @param d1 - Start day
 * @param y1 - Start year
 * @param m2 - End month (1-12)
 * @param d2 - End day
 * @param y2 - End year
 * @param checkDate - Date to check against
 */
export function diaryBlock(
    m1: number,
    d1: number,
    y1: number,
    m2: number,
    d2: number,
    y2: number,
    checkDate: Date
): DiarySexpResult {
    const startDate = new Date(y1, m1 - 1, d1);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(y2, m2 - 1, d2);
    endDate.setHours(23, 59, 59, 999);

    const checkDateNorm = new Date(checkDate);
    checkDateNorm.setHours(12, 0, 0, 0); // Normalize to noon to avoid edge cases

    if (checkDateNorm >= startDate && checkDateNorm <= endDate) {
        return {
            matches: true,
            description: `Block: ${m1}/${d1}/${y1} - ${m2}/${d2}/${y2}`
        };
    }

    return { matches: false };
}

/**
 * Evaluate diary-date
 *
 * Format: (diary-date MONTH DAY YEAR)
 * Matches a specific date. Any argument can be 't' for any.
 *
 * @param month - Month (1-12) or null for any
 * @param day - Day or null for any
 * @param year - Year or null for any
 * @param checkDate - Date to check against
 */
export function diaryDate(
    month: number | null,
    day: number | null,
    year: number | null,
    checkDate: Date
): DiarySexpResult {
    const checkMonth = checkDate.getMonth() + 1;
    const checkDay = checkDate.getDate();
    const checkYear = checkDate.getFullYear();

    // Check each component (null means any/t)
    if (month !== null && checkMonth !== month) {
        return { matches: false };
    }
    if (day !== null && checkDay !== day) {
        return { matches: false };
    }
    if (year !== null && checkYear !== year) {
        return { matches: false };
    }

    const parts: string[] = [];
    if (month !== null) parts.push(`month=${month}`);
    if (day !== null) parts.push(`day=${day}`);
    if (year !== null) parts.push(`year=${year}`);

    return {
        matches: true,
        description: parts.length > 0 ? `Date: ${parts.join(', ')}` : 'Any date'
    };
}

/**
 * Evaluate org-class
 *
 * Format: (org-class Y1 M1 D1 Y2 M2 D2 DAYNUM &optional SKIP-WEEKS)
 * Matches a specific day of the week between two dates.
 * Used for recurring class schedules (e.g., "every Monday from Jan 15 to May 15").
 *
 * @param y1 - Start year
 * @param m1 - Start month (1-12)
 * @param d1 - Start day
 * @param y2 - End year
 * @param m2 - End month (1-12)
 * @param d2 - End day
 * @param daynum - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
 * @param checkDate - Date to check against
 * @param skipWeeks - Optional array of week numbers to skip (1-indexed from start)
 */
export function orgClass(
    y1: number,
    m1: number,
    d1: number,
    y2: number,
    m2: number,
    d2: number,
    daynum: number,
    checkDate: Date,
    skipWeeks?: number[]
): DiarySexpResult {
    const startDate = new Date(y1, m1 - 1, d1);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(y2, m2 - 1, d2);
    endDate.setHours(23, 59, 59, 999);

    const checkDateNorm = new Date(checkDate);
    checkDateNorm.setHours(12, 0, 0, 0);

    // Check if date is within the class period
    if (checkDateNorm < startDate || checkDateNorm > endDate) {
        return { matches: false };
    }

    // Check if it's the right day of the week
    if (checkDateNorm.getDay() !== daynum) {
        return { matches: false };
    }

    // Calculate week number from start
    if (skipWeeks && skipWeeks.length > 0) {
        const msPerDay = 1000 * 60 * 60 * 24;
        const daysSinceStart = Math.floor((checkDateNorm.getTime() - startDate.getTime()) / msPerDay);
        const weekNumber = Math.floor(daysSinceStart / 7) + 1;

        if (skipWeeks.includes(weekNumber)) {
            return { matches: false };
        }
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
        matches: true,
        description: `Class: ${dayNames[daynum]}s (${m1}/${d1}/${y1} - ${m2}/${d2}/${y2})`
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

        case 'diary-cyclic': {
            const [n, month, day, year] = parsed.args;
            if (typeof n !== 'number' || typeof month !== 'number' ||
                typeof day !== 'number' || typeof year !== 'number') {
                return { matches: false, description: 'Invalid diary-cyclic arguments' };
            }
            return diaryCyclic(n, month, day, year, checkDate);
        }

        case 'diary-block': {
            const [m1, d1, y1, m2, d2, y2] = parsed.args;
            if (typeof m1 !== 'number' || typeof d1 !== 'number' || typeof y1 !== 'number' ||
                typeof m2 !== 'number' || typeof d2 !== 'number' || typeof y2 !== 'number') {
                return { matches: false, description: 'Invalid diary-block arguments' };
            }
            return diaryBlock(m1, d1, y1, m2, d2, y2, checkDate);
        }

        case 'diary-date': {
            const [month, day, year] = parsed.args;
            // Each argument can be null (for 't') or a number
            const monthVal = month === null ? null : (typeof month === 'number' ? month : null);
            const dayVal = day === null ? null : (typeof day === 'number' ? day : null);
            const yearVal = year === null ? null : (typeof year === 'number' ? year : null);
            return diaryDate(monthVal, dayVal, yearVal, checkDate);
        }

        case 'org-class': {
            const [y1, m1, d1, y2, m2, d2, daynum, ...rest] = parsed.args;
            if (typeof y1 !== 'number' || typeof m1 !== 'number' || typeof d1 !== 'number' ||
                typeof y2 !== 'number' || typeof m2 !== 'number' || typeof d2 !== 'number' ||
                typeof daynum !== 'number') {
                return { matches: false, description: 'Invalid org-class arguments' };
            }
            // Parse optional skip-weeks (could be individual numbers or remain unparsed)
            const skipWeeks: number[] = [];
            for (const arg of rest) {
                if (typeof arg === 'number') {
                    skipWeeks.push(arg);
                }
            }
            return orgClass(y1, m1, d1, y2, m2, d2, daynum, checkDate, skipWeeks.length > 0 ? skipWeeks : undefined);
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
