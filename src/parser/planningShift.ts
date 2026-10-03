/**
 * Moving tasks that wait on a task whose date changed.
 *
 * When a task's deadline moves by N days, the tasks that depend on it (directly
 * or through others) can move by the same N days, so the gaps between them
 * stay as they were. Pure functions; the project view applies the edits.
 */

import { DAY_NAMES_SHORT } from '../utils/dateConstants';

/** The parts of a task these functions need. */
export interface ShiftableTask {
    id?: string;
    dependsIds: string[];
    isDone: boolean;
    scheduled?: Date;
    deadline?: Date;
}

/**
 * Tasks that wait on `task`, directly or through other tasks, that are not
 * done and have a SCHEDULED or DEADLINE date to move. In dependency order.
 */
export function dependentsToShift<T extends ShiftableTask>(task: T, tasks: T[]): T[] {
    if (!task.id) return [];
    const result: T[] = [];
    const seen = new Set<string>([task.id]);
    const queue = [task.id];
    const visited = new Set<T>([task]);
    while (queue.length) {
        const id = queue.shift()!;
        for (const t of tasks) {
            if (visited.has(t) || !t.dependsIds.includes(id)) continue;
            visited.add(t);
            if (!t.isDone && (t.scheduled || t.deadline)) result.push(t);
            if (t.id && !seen.has(t.id)) {
                seen.add(t.id);
                queue.push(t.id);
            }
        }
    }
    return result;
}

/** Whole days from a to b (local dates, ignoring daylight saving changes). */
export function dayDelta(a: Date, b: Date): number {
    const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ub - ua) / 86400000);
}

const PLANNING_TS = /\b(SCHEDULED|DEADLINE):(\s*)([<[])(\d{4})-(\d{2})-(\d{2})(?: [^\s\d>\]]+)?/g;

/**
 * Move the SCHEDULED and DEADLINE dates on a planning line by `days`, keeping
 * times, repeaters and warning periods. CLOSED is left alone. Returns the line
 * unchanged if it has neither.
 */
export function shiftPlanningLine(line: string, days: number): string {
    return line.replace(PLANNING_TS, (_m, keyword: string, space: string, open: string, y: string, mo: string, d: string) => {
        const date = new Date(Number(y), Number(mo) - 1, Number(d) + days);
        const iso = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
        ].join('-');
        return `${keyword}:${space}${open}${iso} ${DAY_NAMES_SHORT[date.getDay()]}`;
    });
}

/**
 * The 0-based planning lines (SCHEDULED/DEADLINE) of the heading on 0-based
 * `headingLine`: the lines directly under it, before its body starts.
 */
export function planningLines(lines: string[], headingLine: number): number[] {
    const result: number[] = [];
    for (let i = headingLine + 1; i < lines.length; i++) {
        const text = lines[i];
        if (/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(text)) {
            if (/\b(SCHEDULED|DEADLINE):/.test(text)) result.push(i);
            continue;
        }
        break;
    }
    return result;
}

/** The date of `keyword`'s timestamp on a planning line, if it has one. */
export function planningDate(line: string, keyword: 'SCHEDULED' | 'DEADLINE'): Date | undefined {
    const m = new RegExp(`\\b${keyword}:\\s*[<[](\\d{4})-(\\d{2})-(\\d{2})`).exec(line);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/**
 * The 0-based heading line that owns the planning line `line`, or -1 if `line`
 * is not a SCHEDULED/DEADLINE line directly under a heading.
 */
export function headingForPlanningLine(lines: string[], line: number): number {
    if (!/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(lines[line] ?? '')) return -1;
    for (let i = line - 1; i >= 0; i--) {
        if (/^\*+\s/.test(lines[i])) return i;
        if (!/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(lines[i])) return -1;
    }
    return -1;
}

/** The DEADLINE date of the heading on 0-based `headingLine`. */
export function headingDeadline(lines: string[], headingLine: number): Date | undefined {
    for (const i of planningLines(lines, headingLine)) {
        const date = planningDate(lines[i], 'DEADLINE');
        if (date) return date;
    }
    return undefined;
}
