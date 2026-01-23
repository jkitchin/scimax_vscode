/**
 * Shared date constants for consistent formatting across the codebase
 */

/** Short day names (Sunday = index 0) */
export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Full day names (Sunday = index 0) */
export const DAY_NAMES_FULL = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
] as const;

/** Short month names (January = index 0) */
export const MONTH_NAMES_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const;

/** Full month names (January = index 0) */
export const MONTH_NAMES_FULL = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
] as const;

/**
 * Get short day name for a date
 */
export function getDayNameShort(date: Date): string {
    return DAY_NAMES_SHORT[date.getDay()];
}

/**
 * Get full day name for a date
 */
export function getDayNameFull(date: Date): string {
    return DAY_NAMES_FULL[date.getDay()];
}

/**
 * Get short month name for a date
 */
export function getMonthNameShort(date: Date): string {
    return MONTH_NAMES_SHORT[date.getMonth()];
}

/**
 * Get full month name for a date
 */
export function getMonthNameFull(date: Date): string {
    return MONTH_NAMES_FULL[date.getMonth()];
}
