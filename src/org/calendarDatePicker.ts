/**
 * Calendar Date Picker
 *
 * A webview-based calendar for selecting dates when setting
 * DEADLINE, SCHEDULED, or inserting timestamps.
 */

import * as vscode from 'vscode';
import { parseRelativeDate } from '../utils/dateParser';

/**
 * Show a calendar date picker and return the selected date
 */
export async function showCalendarDatePicker(
    extensionUri: vscode.Uri,
    title: string = 'Select Date'
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
        let currentYear = today.getFullYear();
        let currentMonth = today.getMonth();

        function updateContent() {
            panel.webview.html = getCalendarHtml(currentYear, currentMonth, today, title);
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
                    currentMonth--;
                    if (currentMonth < 0) {
                        currentMonth = 11;
                        currentYear--;
                    }
                    updateContent();
                    break;
                case 'nextMonth':
                    currentMonth++;
                    if (currentMonth > 11) {
                        currentMonth = 0;
                        currentYear++;
                    }
                    updateContent();
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
                    currentMonth = message.month;
                    updateContent();
                    break;
                case 'goToYear':
                    currentYear = message.year;
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

function getCalendarHtml(year: number, month: number, today: Date, title: string): string {
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    // Build calendar grid
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    let calendarHtml = '';

    // Header row (weekdays)
    const dayHeaders = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    calendarHtml += '<div class="calendar-header">';
    for (const day of dayHeaders) {
        calendarHtml += `<div class="day-header">${day}</div>`;
    }
    calendarHtml += '</div>';

    // Day cells
    calendarHtml += '<div class="calendar-grid">';

    // Empty cells before first day
    for (let i = 0; i < startDayOfWeek; i++) {
        calendarHtml += '<div class="day empty"></div>';
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const isToday = isCurrentMonth && day === today.getDate();
        const date = new Date(year, month, day);
        const isPast = date < today && !isToday;

        let classes = 'day';
        if (isToday) classes += ' today';
        if (isPast) classes += ' past';

        calendarHtml += `<div class="${classes}" onclick="selectDate(${year}, ${month}, ${day})">${day}</div>`;
    }

    calendarHtml += '</div>';

    // Month picker
    let monthPickerHtml = '<div class="month-picker">';
    for (let m = 0; m < 12; m++) {
        const isActive = m === month;
        let mClass = 'month-btn';
        if (isActive) mClass += ' active';
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

        .day.past {
            opacity: 0.5;
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
            <div class="input-hint">Type a date expression and press Enter</div>
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
                }
            } else if (event.key === 'Escape') {
                cancel();
            }
        }

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
