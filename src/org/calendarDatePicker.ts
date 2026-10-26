/**
 * Calendar Date Picker
 *
 * A webview-based calendar for selecting dates when setting
 * DEADLINE, SCHEDULED, or inserting timestamps.
 */

import * as vscode from 'vscode';
import { parseRelativeDate } from '../utils/dateParser';

export interface CalendarDatePickerOptions {
    /** Dates (YYYY-MM-DD) to mark with a dot, e.g. days with journal entries */
    markedDates?: Set<string>;
    /** Tooltip for marked days */
    markedTooltip?: string;
    /** First day of the week in the grid (default: sunday) */
    weekStartsOn?: 'sunday' | 'monday';
}

/** Format a date as YYYY-MM-DD in local time (the key format for markedDates) */
export function dateKey(date: Date): string {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Move a date by a number of days and/or months. Month moves clamp the day to
 * the end of the target month (Jan 31 + 1 month is Feb 28/29).
 */
export function moveDate(date: Date, days: number = 0, months: number = 0): Date {
    if (months) {
        const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
        const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
        date = new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
    }
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Show a calendar date picker and return the selected date
 */
export async function showCalendarDatePicker(
    extensionUri: vscode.Uri,
    title: string = 'Select Date',
    options: CalendarDatePickerOptions = {}
): Promise<Date | null> {
    return new Promise((resolve) => {
        const panel = vscode.window.createWebviewPanel(
            'scimaxDatePicker',
            title,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: false
            }
        );

        const today = new Date();
        // The highlighted date that arrow keys move and Enter selects.
        // The displayed month always follows it.
        let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        function updateContent() {
            panel.webview.html = getCalendarHtml(
                cursor.getFullYear(), cursor.getMonth(), today, title, options, cursor);
        }

        updateContent();

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'selectDate':
                    const date = new Date(message.year, message.month, message.day);
                    resolve(date);
                    panel.dispose();
                    break;
                case 'prevMonth':
                    cursor = moveDate(cursor, 0, -1);
                    updateContent();
                    break;
                case 'nextMonth':
                    cursor = moveDate(cursor, 0, 1);
                    updateContent();
                    break;
                case 'moveCursor':
                    cursor = moveDate(cursor, message.days ?? 0, message.months ?? 0);
                    updateContent();
                    break;
                case 'selectCursor':
                    resolve(cursor);
                    panel.dispose();
                    break;
                case 'today':
                    resolve(today);
                    panel.dispose();
                    break;
                case 'tomorrow':
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    resolve(tomorrow);
                    panel.dispose();
                    break;
                case 'nextWeek':
                    const nextWeek = new Date(today);
                    nextWeek.setDate(nextWeek.getDate() + 7);
                    resolve(nextWeek);
                    panel.dispose();
                    break;
                case 'goToMonth':
                    cursor = moveDate(cursor, 0, message.month - cursor.getMonth());
                    updateContent();
                    break;
                case 'goToYear':
                    cursor = moveDate(cursor, 0, 12 * (message.year - cursor.getFullYear()));
                    updateContent();
                    break;
                case 'parseInput':
                    const parsed = parseRelativeDate(message.value);
                    if (parsed) {
                        resolve(parsed);
                        panel.dispose();
                    } else {
                        // Send error back to webview
                        panel.webview.postMessage({
                            command: 'parseError',
                            message: 'Invalid date expression'
                        });
                    }
                    break;
                case 'cancel':
                    panel.dispose();
                    resolve(null);
                    break;
            }
        });

        // Handle panel being closed
        panel.onDidDispose(() => {
            resolve(null);
        });
    });
}

export function getCalendarHtml(
    year: number,
    month: number,
    today: Date,
    title: string,
    options: CalendarDatePickerOptions = {},
    cursor?: Date
): string {
    const marked = options.markedDates ?? new Set<string>();
    const markedTooltip = options.markedTooltip ?? '';
    const mondayStart = options.weekStartsOn === 'monday';

    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const cursorDay = cursor && cursor.getFullYear() === year && cursor.getMonth() === month
        ? cursor.getDate() : -1;

    // Build calendar grid
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    let calendarHtml = '';

    // Header row (weekdays)
    const dayHeaders = mondayStart
        ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
        : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    calendarHtml += '<div class="calendar-header">';
    for (const day of dayHeaders) {
        calendarHtml += `<div class="day-header">${day}</div>`;
    }
    calendarHtml += '</div>';

    // Day cells
    calendarHtml += '<div class="calendar-grid">';

    // Empty cells before first day
    const leadingBlanks = mondayStart ? (startDayOfWeek + 6) % 7 : startDayOfWeek;
    for (let i = 0; i < leadingBlanks; i++) {
        calendarHtml += '<div class="day empty"></div>';
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const isToday = isCurrentMonth && day === today.getDate();
        const date = new Date(year, month, day);
        const isPast = date < today && !isToday;
        const isMarked = marked.has(dateKey(date));

        let classes = 'day';
        if (isToday) classes += ' today';
        if (day === cursorDay) classes += ' cursor';
        if (isMarked) classes += ' marked';
        else if (isPast) classes += ' past';

        const tooltip = isMarked && markedTooltip ? ` title="${markedTooltip}"` : '';
        calendarHtml += `<div class="${classes}"${tooltip} onclick="selectDate(${year}, ${month}, ${day})">${day}</div>`;
    }

    calendarHtml += '</div>';

    // Month picker
    let monthPickerHtml = '<div class="month-picker">';
    for (let m = 0; m < 12; m++) {
        const isActive = m === month;
        const monthPrefix = `${year}-${(m + 1).toString().padStart(2, '0')}-`;
        const hasMarked = [...marked].some(k => k.startsWith(monthPrefix));
        let mClass = 'month-btn';
        if (isActive) mClass += ' active';
        if (hasMarked) mClass += ' has-marked';
        monthPickerHtml += `<button class="${mClass}" onclick="goToMonth(${m})">${monthNamesShort[m]}</button>`;
    }
    monthPickerHtml += '</div>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: flex-start;
        }

        .container {
            max-width: 400px;
            width: 100%;
        }

        h2 {
            text-align: center;
            margin-bottom: 16px;
            font-weight: normal;
        }

        .quick-dates {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
            justify-content: center;
        }

        .quick-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
        }

        .quick-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .quick-btn.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .quick-btn.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .text-input-container {
            margin-bottom: 16px;
        }

        .text-input {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            box-sizing: border-box;
        }

        .text-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .text-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .input-hint {
            margin-top: 4px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .input-error {
            color: var(--vscode-errorForeground);
            display: none;
        }

        .nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }

        .nav-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 16px;
        }

        .nav-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .month-year {
            font-weight: bold;
            font-size: 1.2em;
            cursor: pointer;
        }

        .month-year:hover {
            text-decoration: underline;
        }

        .year-nav {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-bottom: 12px;
        }

        .year-btn {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 4px 8px;
            font-size: 0.9em;
        }

        .year-btn:hover {
            color: var(--vscode-foreground);
        }

        .year-btn.active {
            color: var(--vscode-foreground);
            font-weight: bold;
        }

        .month-picker {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 4px;
            margin-bottom: 16px;
        }

        .month-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 0.85em;
        }

        .month-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .month-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .calendar-header {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 4px;
            margin-bottom: 8px;
        }

        .day-header {
            text-align: center;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            padding: 8px 0;
            font-weight: 600;
        }

        .calendar-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 4px;
        }

        .day {
            text-align: center;
            padding: 12px 8px;
            cursor: pointer;
            border-radius: 4px;
            transition: background-color 0.1s;
            font-size: 14px;
        }

        .day:hover:not(.empty) {
            background: var(--vscode-list-hoverBackground);
        }

        .day.empty {
            cursor: default;
        }

        .day.today {
            border: 2px solid var(--vscode-focusBorder);
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }

        .day.cursor {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
            opacity: 1;
        }

        .day.past {
            opacity: 0.5;
        }

        .day.marked {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            padding-bottom: 4px;
        }

        .day.marked::after {
            content: '';
            display: block;
            width: 5px;
            height: 5px;
            background: var(--vscode-textLink-foreground);
            border-radius: 50%;
            margin: 3px auto 0;
        }

        .month-btn.has-marked {
            font-weight: bold;
        }

        .cancel-btn {
            display: block;
            width: 100%;
            margin-top: 16px;
            padding: 10px;
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: 1px solid var(--vscode-input-border);
            cursor: pointer;
            border-radius: 4px;
        }

        .cancel-btn:hover {
            background: var(--vscode-list-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h2>${title}</h2>

        <div class="quick-dates">
            <button class="quick-btn primary" onclick="selectToday()">Today</button>
            <button class="quick-btn" onclick="selectTomorrow()">Tomorrow</button>
            <button class="quick-btn" onclick="selectNextWeek()">Next Week</button>
        </div>

        <div class="text-input-container">
            <input type="text" class="text-input" id="dateInput"
                   placeholder="friday, next friday, +2d, jan 15..."
                   onkeydown="handleInputKeydown(event)">
            <div class="input-hint">Type a date expression and press Enter, or use the arrow keys
                (Shift for a month) and Enter to pick the highlighted day</div>
            <div class="input-error" id="inputError">Invalid date expression</div>
        </div>

        <div class="nav">
            <button class="nav-btn" onclick="prevMonth()">&lt;</button>
            <span class="month-year" onclick="toggleMonthPicker()">${monthNames[month]} ${year}</span>
            <button class="nav-btn" onclick="nextMonth()">&gt;</button>
        </div>

        <div class="year-nav">
            <button class="year-btn" onclick="goToYear(${year - 2})">${year - 2}</button>
            <button class="year-btn" onclick="goToYear(${year - 1})">${year - 1}</button>
            <button class="year-btn active">${year}</button>
            <button class="year-btn" onclick="goToYear(${year + 1})">${year + 1}</button>
        </div>

        <div id="monthPicker" style="display: none;">
            ${monthPickerHtml}
        </div>

        ${calendarHtml}

        <button class="cancel-btn" onclick="cancel()">Cancel</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function selectDate(year, month, day) {
            vscode.postMessage({ command: 'selectDate', year, month, day });
        }

        function selectToday() {
            vscode.postMessage({ command: 'today' });
        }

        function selectTomorrow() {
            vscode.postMessage({ command: 'tomorrow' });
        }

        function selectNextWeek() {
            vscode.postMessage({ command: 'nextWeek' });
        }

        function prevMonth() {
            vscode.postMessage({ command: 'prevMonth' });
        }

        function nextMonth() {
            vscode.postMessage({ command: 'nextMonth' });
        }

        function goToMonth(month) {
            vscode.postMessage({ command: 'goToMonth', month });
        }

        function goToYear(year) {
            vscode.postMessage({ command: 'goToYear', year });
        }

        function toggleMonthPicker() {
            const picker = document.getElementById('monthPicker');
            picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
        }

        function handleInputKeydown(event) {
            if (event.key === 'Enter') {
                const input = document.getElementById('dateInput');
                const value = input.value.trim();
                if (value) {
                    vscode.postMessage({ command: 'parseInput', value });
                } else {
                    vscode.postMessage({ command: 'selectCursor' });
                }
            } else if (event.key === 'Escape') {
                cancel();
            }
        }

        // Arrow keys move the highlighted day: left/right by a day, up/down by
        // a week, and with Shift, back (left/up) or forward (right/down) a month.
        // They are left alone while the text input holds text, so the caret
        // still moves when editing an expression.
        const ARROW_MOVES = {
            ArrowLeft: [-1, -1], ArrowRight: [1, 1],
            ArrowUp: [-7, -1], ArrowDown: [7, 1]
        };
        document.addEventListener('keydown', event => {
            const move = ARROW_MOVES[event.key];
            if (!move || event.altKey || event.ctrlKey || event.metaKey) return;
            const input = document.getElementById('dateInput');
            if (event.target === input && input.value !== '') return;
            event.preventDefault();
            if (event.shiftKey) {
                vscode.postMessage({ command: 'moveCursor', months: move[1] });
            } else {
                vscode.postMessage({ command: 'moveCursor', days: move[0] });
            }
        });

        // Enter selects the highlighted day when focus is outside the input
        document.addEventListener('keydown', event => {
            if (event.key === 'Enter' && event.target === document.body) {
                vscode.postMessage({ command: 'selectCursor' });
            }
        });

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'parseError') {
                const errorEl = document.getElementById('inputError');
                errorEl.style.display = 'block';
                setTimeout(() => {
                    errorEl.style.display = 'none';
                }, 2000);
            }
        });

        // Focus input on load
        document.getElementById('dateInput').focus();
    </script>
</body>
</html>`;
}
