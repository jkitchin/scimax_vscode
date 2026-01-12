/**
 * Org-mode clocking and time tracking system
 * Provides clock in/out, duration calculation, and time reports
 */

import type {
    HeadlineElement,
    OrgDocumentNode,
    TimestampObject,
    ClockElement,
} from './orgElementTypes';

// =============================================================================
// Clock Entry Types
// =============================================================================

/**
 * Represents a single clock entry
 */
export interface ClockEntry {
    /** Start time of the clock */
    start: Date;
    /** End time of the clock (undefined if still running) */
    end?: Date;
    /** Duration in minutes (calculated if end is present) */
    duration?: number;
    /** The headline this clock belongs to */
    headline?: HeadlineElement;
    /** File path containing this clock */
    filePath?: string;
    /** Line number of the clock entry */
    lineNumber?: number;
}

/**
 * Clock state for a headline
 */
export interface ClockState {
    /** Whether clock is currently running */
    isRunning: boolean;
    /** Current clock entry (if running) */
    currentClock?: ClockEntry;
    /** All clock entries for this headline */
    entries: ClockEntry[];
    /** Total clocked time in minutes */
    totalMinutes: number;
}

/**
 * Time report entry for a headline
 */
export interface TimeReportEntry {
    /** Headline title */
    title: string;
    /** Headline level */
    level: number;
    /** Tags */
    tags: string[];
    /** Category */
    category?: string;
    /** Total time in minutes */
    totalMinutes: number;
    /** Formatted time string (H:MM) */
    formattedTime: string;
    /** Child entries (for hierarchical reports) */
    children: TimeReportEntry[];
    /** Percentage of parent time */
    percentage?: number;
}

/**
 * Time report configuration
 */
export interface TimeReportConfig {
    /** Report type */
    type: 'daily' | 'weekly' | 'monthly' | 'custom';
    /** Start date for the report */
    startDate?: Date;
    /** End date for the report */
    endDate?: Date;
    /** Whether to include headline hierarchy */
    hierarchical?: boolean;
    /** Maximum depth to include */
    maxDepth?: number;
    /** Tags to filter by */
    tags?: string[];
    /** Categories to filter by */
    categories?: string[];
    /** Whether to show percentages */
    showPercentages?: boolean;
    /** Whether to include empty headlines */
    includeEmpty?: boolean;
}

/**
 * Clock table configuration
 */
export interface ClockTableConfig {
    /** Scope of the table */
    scope: 'file' | 'subtree' | 'agenda';
    /** Maximum level to include */
    maxLevel?: number;
    /** Whether to include timestamps */
    timestamps?: boolean;
    /** Block name for the clock table */
    block?: string;
    /** Formula for calculating totals */
    formula?: string;
    /** Whether to show file column */
    showFile?: boolean;
    /** Time span filter */
    span?: 'today' | 'thisweek' | 'thismonth' | 'untilnow' | 'all';
}

// =============================================================================
// Clock Parsing
// =============================================================================

/**
 * Parse a clock line from org text
 */
export function parseClockLine(line: string): ClockEntry | null {
    // CLOCK: [2024-01-15 Mon 10:30]--[2024-01-15 Mon 12:00] =>  1:30
    // CLOCK: [2024-01-15 Mon 10:30]
    const clockPattern =
        /^CLOCK:\s*\[(\d{4})-(\d{2})-(\d{2})\s+\w+(?:\s+(\d{2}):(\d{2}))?\](?:--\[(\d{4})-(\d{2})-(\d{2})\s+\w+(?:\s+(\d{2}):(\d{2}))?\](?:\s*=>\s*(\d+):(\d{2}))?)?/;

    const match = line.match(clockPattern);
    if (!match) return null;

    const [
        ,
        startYear,
        startMonth,
        startDay,
        startHour,
        startMinute,
        endYear,
        endMonth,
        endDay,
        endHour,
        endMinute,
        durationHours,
        durationMinutes,
    ] = match;

    const start = new Date(
        parseInt(startYear),
        parseInt(startMonth) - 1,
        parseInt(startDay),
        startHour ? parseInt(startHour) : 0,
        startMinute ? parseInt(startMinute) : 0
    );

    const entry: ClockEntry = { start };

    if (endYear && endMonth && endDay) {
        entry.end = new Date(
            parseInt(endYear),
            parseInt(endMonth) - 1,
            parseInt(endDay),
            endHour ? parseInt(endHour) : 0,
            endMinute ? parseInt(endMinute) : 0
        );
    }

    if (durationHours !== undefined && durationMinutes !== undefined) {
        entry.duration = parseInt(durationHours) * 60 + parseInt(durationMinutes);
    } else if (entry.end) {
        entry.duration = Math.round((entry.end.getTime() - start.getTime()) / 60000);
    }

    return entry;
}

/**
 * Parse a ClockElement from the AST
 */
export function parseClockElement(clock: ClockElement): ClockEntry | null {
    const props = clock.properties;

    const start = new Date(
        props.startYear,
        props.startMonth - 1,
        props.startDay,
        props.startHour ?? 0,
        props.startMinute ?? 0
    );

    const entry: ClockEntry = { start };

    if (props.endYear !== undefined && props.endMonth !== undefined && props.endDay !== undefined) {
        entry.end = new Date(
            props.endYear,
            props.endMonth - 1,
            props.endDay,
            props.endHour ?? 0,
            props.endMinute ?? 0
        );
    }

    if (props.durationHours !== undefined && props.durationMinutes !== undefined) {
        entry.duration = props.durationHours * 60 + props.durationMinutes;
    } else if (entry.end) {
        entry.duration = Math.round((entry.end.getTime() - start.getTime()) / 60000);
    }

    return entry;
}

// =============================================================================
// Clock Operations
// =============================================================================

/**
 * Format a date as org-mode timestamp
 */
export function formatClockTimestamp(date: Date, includeTime = true): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dayName = days[date.getDay()];

    if (!includeTime) {
        return `[${year}-${month}-${day} ${dayName}]`;
    }

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `[${year}-${month}-${day} ${dayName} ${hours}:${minutes}]`;
}

/**
 * Format duration in minutes as H:MM
 */
export function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${String(mins).padStart(2, '0')}`;
}

/**
 * Format duration with days if needed
 */
export function formatDurationLong(minutes: number): string {
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const mins = minutes % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${mins}m`);

    return parts.join(' ');
}

/**
 * Generate a clock-in line
 */
export function generateClockIn(date: Date = new Date()): string {
    return `CLOCK: ${formatClockTimestamp(date)}`;
}

/**
 * Generate a clock-out line (closing an existing clock)
 */
export function generateClockOut(start: Date, end: Date = new Date()): string {
    const duration = Math.round((end.getTime() - start.getTime()) / 60000);
    return `CLOCK: ${formatClockTimestamp(start)}--${formatClockTimestamp(end)} => ${formatDuration(duration)}`;
}

/**
 * Clock into a headline (returns the line to insert)
 */
export function clockIn(headline?: HeadlineElement): ClockEntry {
    const entry: ClockEntry = {
        start: new Date(),
        headline,
    };
    return entry;
}

/**
 * Clock out of a running clock entry
 */
export function clockOut(entry: ClockEntry): ClockEntry {
    const end = new Date();
    entry.end = end;
    entry.duration = Math.round((end.getTime() - entry.start.getTime()) / 60000);
    return entry;
}

/**
 * Cancel a running clock
 */
export function clockCancel(entry: ClockEntry): void {
    entry.end = undefined;
    entry.duration = undefined;
}

// =============================================================================
// Clock Collection and Analysis
// =============================================================================

/**
 * Collect all clock entries from a headline
 */
export function collectClockEntries(headline: HeadlineElement): ClockEntry[] {
    const entries: ClockEntry[] = [];

    if (headline.section) {
        for (const element of headline.section.children) {
            if (element.type === 'clock') {
                const entry = parseClockElement(element as ClockElement);
                if (entry) {
                    entry.headline = headline;
                    entries.push(entry);
                }
            }
        }
    }

    return entries;
}

/**
 * Collect all clock entries from a document
 */
export function collectAllClockEntries(doc: OrgDocumentNode): ClockEntry[] {
    const entries: ClockEntry[] = [];

    const processHeadline = (headline: HeadlineElement) => {
        entries.push(...collectClockEntries(headline));
        headline.children.forEach(processHeadline);
    };

    doc.children.forEach(processHeadline);
    return entries;
}

/**
 * Calculate total clocked time for a headline (including children)
 */
export function calculateTotalTime(
    headline: HeadlineElement,
    options: { includeChildren?: boolean; startDate?: Date; endDate?: Date } = {}
): number {
    const { includeChildren = true, startDate, endDate } = options;

    let total = 0;

    // Get direct clock entries
    const entries = collectClockEntries(headline);
    for (const entry of entries) {
        if (entry.duration && isInRange(entry, startDate, endDate)) {
            total += entry.duration;
        }
    }

    // Add children if requested
    if (includeChildren) {
        for (const child of headline.children) {
            total += calculateTotalTime(child, options);
        }
    }

    return total;
}

/**
 * Check if a clock entry is within a date range
 */
function isInRange(entry: ClockEntry, startDate?: Date, endDate?: Date): boolean {
    if (startDate && entry.start < startDate) return false;
    if (endDate && entry.end && entry.end > endDate) return false;
    if (endDate && !entry.end && entry.start > endDate) return false;
    return true;
}

/**
 * Get clock state for a headline
 */
export function getClockState(headline: HeadlineElement): ClockState {
    const entries = collectClockEntries(headline);
    const runningEntry = entries.find((e) => !e.end);

    return {
        isRunning: !!runningEntry,
        currentClock: runningEntry,
        entries,
        totalMinutes: entries.reduce((sum, e) => sum + (e.duration || 0), 0),
    };
}

// =============================================================================
// Time Reports
// =============================================================================

/**
 * Generate a time report for a headline tree
 */
export function generateTimeReport(
    headlines: HeadlineElement[],
    config: TimeReportConfig = { type: 'custom' }
): TimeReportEntry[] {
    const { startDate, endDate } = getDateRange(config);

    const processHeadline = (headline: HeadlineElement, depth: number): TimeReportEntry | null => {
        // Check depth limit
        if (config.maxDepth !== undefined && depth > config.maxDepth) {
            return null;
        }

        // Filter by tags
        if (config.tags && config.tags.length > 0) {
            if (!config.tags.some((tag) => headline.properties.tags.includes(tag))) {
                return null;
            }
        }

        // Filter by category
        if (config.categories && config.categories.length > 0) {
            const category =
                headline.properties.category || getFileCategory(headline) || 'default';
            if (!config.categories.includes(category)) {
                return null;
            }
        }

        // Calculate time for this headline
        const totalMinutes = calculateTotalTime(headline, {
            includeChildren: false,
            startDate,
            endDate,
        });

        // Process children
        const children: TimeReportEntry[] = [];
        if (config.hierarchical !== false) {
            for (const child of headline.children) {
                const childEntry = processHeadline(child, depth + 1);
                if (childEntry) {
                    children.push(childEntry);
                }
            }
        }

        // Calculate total including children
        const childrenTime = children.reduce((sum, c) => sum + c.totalMinutes, 0);
        const finalTotal = totalMinutes + childrenTime;

        // Skip empty entries if configured
        if (!config.includeEmpty && finalTotal === 0) {
            return null;
        }

        return {
            title: headline.properties.rawValue,
            level: headline.properties.level,
            tags: headline.properties.tags,
            category: headline.properties.category || getFileCategory(headline),
            totalMinutes: finalTotal,
            formattedTime: formatDuration(finalTotal),
            children,
        };
    };

    const entries = headlines
        .map((h) => processHeadline(h, 1))
        .filter((e): e is TimeReportEntry => e !== null);

    // Calculate percentages if requested
    if (config.showPercentages) {
        const totalTime = entries.reduce((sum, e) => sum + e.totalMinutes, 0);
        calculatePercentages(entries, totalTime);
    }

    return entries;
}

/**
 * Calculate percentages for report entries
 */
function calculatePercentages(entries: TimeReportEntry[], parentTotal: number): void {
    for (const entry of entries) {
        entry.percentage = parentTotal > 0 ? (entry.totalMinutes / parentTotal) * 100 : 0;
        if (entry.children.length > 0) {
            calculatePercentages(entry.children, entry.totalMinutes);
        }
    }
}

/**
 * Get date range for a report config
 */
function getDateRange(config: TimeReportConfig): { startDate?: Date; endDate?: Date } {
    if (config.startDate || config.endDate) {
        return { startDate: config.startDate, endDate: config.endDate };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (config.type) {
        case 'daily':
            return {
                startDate: today,
                endDate: new Date(today.getTime() + 24 * 60 * 60 * 1000),
            };
        case 'weekly': {
            const dayOfWeek = today.getDay();
            const weekStart = new Date(today.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
            return {
                startDate: weekStart,
                endDate: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
            };
        }
        case 'monthly': {
            const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            return { startDate: monthStart, endDate: monthEnd };
        }
        default:
            return {};
    }
}

/**
 * Get category from file name (placeholder - would need file path)
 */
function getFileCategory(_headline: HeadlineElement): string | undefined {
    return undefined;
}

/**
 * Format a time report as text
 */
export function formatTimeReport(entries: TimeReportEntry[], indent = 0): string {
    const lines: string[] = [];

    for (const entry of entries) {
        const prefix = '  '.repeat(indent);
        const timeStr = entry.formattedTime.padStart(6);
        const percentStr = entry.percentage !== undefined ? ` (${entry.percentage.toFixed(0)}%)` : '';

        lines.push(`${prefix}${timeStr}${percentStr}  ${entry.title}`);

        if (entry.children.length > 0) {
            lines.push(formatTimeReport(entry.children, indent + 1));
        }
    }

    return lines.join('\n');
}

// =============================================================================
// Clock Table Generation
// =============================================================================

/**
 * Generate a clock table for org-mode
 */
export function generateClockTable(
    headlines: HeadlineElement[],
    config: ClockTableConfig = { scope: 'subtree' }
): string {
    const lines: string[] = [];

    // Header
    if (config.showFile) {
        lines.push('| File | Headline | Time |');
        lines.push('|---+---+---|');
    } else {
        lines.push('| Headline | Time |');
        lines.push('|---+---|');
    }

    // Get date range based on span
    const dateRange = getSpanDateRange(config.span);

    // Collect entries
    const tableEntries: Array<{
        level: number;
        title: string;
        time: number;
        file?: string;
    }> = [];

    const processHeadline = (headline: HeadlineElement, depth: number) => {
        if (config.maxLevel && depth > config.maxLevel) return;

        const time = calculateTotalTime(headline, {
            includeChildren: false,
            ...dateRange,
        });

        if (time > 0) {
            const levelPrefix = '*'.repeat(headline.properties.level);
            tableEntries.push({
                level: headline.properties.level,
                title: `${levelPrefix} ${headline.properties.rawValue}`,
                time,
            });
        }

        headline.children.forEach((child) => processHeadline(child, depth + 1));
    };

    headlines.forEach((h) => processHeadline(h, 1));

    // Generate table rows
    for (const entry of tableEntries) {
        const timeStr = formatDuration(entry.time);
        if (config.showFile) {
            lines.push(`| ${entry.file || ''} | ${entry.title} | ${timeStr} |`);
        } else {
            lines.push(`| ${entry.title} | ${timeStr} |`);
        }
    }

    // Total row
    const totalTime = tableEntries.reduce((sum, e) => sum + e.time, 0);
    if (config.showFile) {
        lines.push('|---+---+---|');
        lines.push(`| | *Total* | ${formatDuration(totalTime)} |`);
    } else {
        lines.push('|---+---|');
        lines.push(`| *Total* | ${formatDuration(totalTime)} |`);
    }

    return lines.join('\n');
}

/**
 * Get date range for clock table span
 */
function getSpanDateRange(span?: string): { startDate?: Date; endDate?: Date } {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (span) {
        case 'today':
            return {
                startDate: today,
                endDate: new Date(today.getTime() + 24 * 60 * 60 * 1000),
            };
        case 'thisweek': {
            const dayOfWeek = today.getDay();
            const weekStart = new Date(today.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
            return {
                startDate: weekStart,
                endDate: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
            };
        }
        case 'thismonth': {
            const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            return { startDate: monthStart, endDate: monthEnd };
        }
        case 'untilnow':
            return { endDate: now };
        default:
            return {};
    }
}

// =============================================================================
// Clock Effort Estimation
// =============================================================================

/**
 * Parse effort string (e.g., "1:30", "2h", "90m")
 */
export function parseEffort(effort: string): number {
    // H:MM format
    const hmMatch = effort.match(/^(\d+):(\d{2})$/);
    if (hmMatch) {
        return parseInt(hmMatch[1]) * 60 + parseInt(hmMatch[2]);
    }

    // Hours format (1h, 2h, etc.)
    const hMatch = effort.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/i);
    if (hMatch) {
        return Math.round(parseFloat(hMatch[1]) * 60);
    }

    // Minutes format (30m, 90m, etc.)
    const mMatch = effort.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/i);
    if (mMatch) {
        return parseInt(mMatch[1]);
    }

    // Days format (1d, 2d, etc.)
    const dMatch = effort.match(/^(\d+(?:\.\d+)?)\s*d(?:ays?)?$/i);
    if (dMatch) {
        return Math.round(parseFloat(dMatch[1]) * 8 * 60); // 8 hours per day
    }

    // Plain number (assume minutes)
    const numMatch = effort.match(/^(\d+)$/);
    if (numMatch) {
        return parseInt(numMatch[1]);
    }

    return 0;
}

/**
 * Format effort in minutes to string
 */
export function formatEffort(minutes: number, format: 'short' | 'long' = 'short'): string {
    if (format === 'short') {
        return formatDuration(minutes);
    }
    return formatDurationLong(minutes);
}

/**
 * Compare clocked time to estimated effort
 */
export function compareEffort(
    headline: HeadlineElement
): { estimated: number; actual: number; difference: number; percentage: number } | null {
    const effortProp = headline.properties.effort;
    if (!effortProp) return null;

    const estimated = parseEffort(effortProp);
    const actual = calculateTotalTime(headline, { includeChildren: true });
    const difference = actual - estimated;
    const percentage = estimated > 0 ? (actual / estimated) * 100 : 0;

    return { estimated, actual, difference, percentage };
}

// =============================================================================
// Clock Consistency Checking
// =============================================================================

/**
 * Issues found in clock entries
 */
export interface ClockIssue {
    type: 'gap' | 'overlap' | 'running' | 'future' | 'negative' | 'long';
    message: string;
    entry: ClockEntry;
    relatedEntry?: ClockEntry;
}

/**
 * Check clock entries for issues
 */
export function checkClockConsistency(entries: ClockEntry[]): ClockIssue[] {
    const issues: ClockIssue[] = [];
    const now = new Date();

    // Sort by start time
    const sorted = [...entries].sort((a, b) => a.start.getTime() - b.start.getTime());

    for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];

        // Check for running clocks
        if (!entry.end) {
            issues.push({
                type: 'running',
                message: `Clock is still running since ${formatClockTimestamp(entry.start)}`,
                entry,
            });
        }

        // Check for future dates
        if (entry.start > now) {
            issues.push({
                type: 'future',
                message: `Clock starts in the future: ${formatClockTimestamp(entry.start)}`,
                entry,
            });
        }

        // Check for negative duration
        if (entry.end && entry.end < entry.start) {
            issues.push({
                type: 'negative',
                message: `End time is before start time`,
                entry,
            });
        }

        // Check for very long entries (> 12 hours)
        if (entry.duration && entry.duration > 12 * 60) {
            issues.push({
                type: 'long',
                message: `Clock entry is longer than 12 hours (${formatDuration(entry.duration)})`,
                entry,
            });
        }

        // Check for overlaps with next entry
        if (i < sorted.length - 1 && entry.end) {
            const next = sorted[i + 1];
            if (entry.end > next.start) {
                issues.push({
                    type: 'overlap',
                    message: `Clock entries overlap`,
                    entry,
                    relatedEntry: next,
                });
            }
        }
    }

    return issues;
}

// =============================================================================
// Exports
// =============================================================================

export {
    type ClockEntry,
    type ClockState,
    type TimeReportEntry,
    type TimeReportConfig,
    type ClockTableConfig,
    type ClockIssue,
};
