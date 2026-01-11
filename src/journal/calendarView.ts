import * as vscode from 'vscode';
import { JournalManager, JournalEntry } from './journalManager';

/**
 * WebView-based calendar for journal navigation
 */
export class JournalCalendarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'scimax.journal.calendar';

    private _view?: vscode.WebviewView;
    private currentYear: number;
    private currentMonth: number;

    constructor(
        private readonly manager: JournalManager,
        private readonly extensionUri: vscode.Uri
    ) {
        const now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'openDate':
                    const date = new Date(message.year, message.month, message.day);
                    await this.manager.openEntry(date);
                    break;
                case 'prevMonth':
                    this.currentMonth--;
                    if (this.currentMonth < 0) {
                        this.currentMonth = 11;
                        this.currentYear--;
                    }
                    this.refresh();
                    break;
                case 'nextMonth':
                    this.currentMonth++;
                    if (this.currentMonth > 11) {
                        this.currentMonth = 0;
                        this.currentYear++;
                    }
                    this.refresh();
                    break;
                case 'today':
                    const now = new Date();
                    this.currentYear = now.getFullYear();
                    this.currentMonth = now.getMonth();
                    this.refresh();
                    await this.manager.openEntry(now);
                    break;
            }
        });
    }

    public refresh(): void {
        if (this._view) {
            this._view.webview.html = this.getHtmlContent();
        }
    }

    private getHtmlContent(): string {
        const entries = this.manager.getEntriesForMonth(this.currentYear, this.currentMonth);
        const entryDays = new Set(entries.map(e => e.date.getDate()));

        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        const today = new Date();
        const isCurrentMonth = today.getFullYear() === this.currentYear &&
                               today.getMonth() === this.currentMonth;

        // Build calendar grid
        const firstDay = new Date(this.currentYear, this.currentMonth, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
        const startDayOfWeek = firstDay.getDay();
        const daysInMonth = lastDay.getDate();

        let calendarHtml = '';

        // Header row
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
            const hasEntry = entryDays.has(day);
            const isToday = isCurrentMonth && day === today.getDate();

            let classes = 'day';
            if (hasEntry) classes += ' has-entry';
            if (isToday) classes += ' today';

            calendarHtml += `<div class="${classes}" onclick="openDate(${this.currentYear}, ${this.currentMonth}, ${day})">${day}</div>`;
        }

        calendarHtml += '</div>';

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
            padding: 8px;
            margin: 0;
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
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 3px;
        }

        .nav-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .month-year {
            font-weight: bold;
            font-size: 1.1em;
        }

        .calendar-header {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
            margin-bottom: 4px;
        }

        .day-header {
            text-align: center;
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            padding: 4px 0;
        }

        .calendar-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
        }

        .day {
            text-align: center;
            padding: 6px 4px;
            cursor: pointer;
            border-radius: 3px;
            transition: background-color 0.1s;
        }

        .day:hover:not(.empty) {
            background: var(--vscode-list-hoverBackground);
        }

        .day.empty {
            cursor: default;
        }

        .day.has-entry {
            background: var(--vscode-button-secondaryBackground);
            font-weight: bold;
        }

        .day.has-entry:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .day.today {
            border: 2px solid var(--vscode-focusBorder);
            padding: 4px 2px;
        }

        .today-btn {
            display: block;
            width: 100%;
            margin-top: 12px;
            padding: 8px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            border-radius: 3px;
        }

        .today-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .stats {
            margin-top: 12px;
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="nav">
        <button class="nav-btn" onclick="prevMonth()">◀</button>
        <span class="month-year">${monthNames[this.currentMonth]} ${this.currentYear}</span>
        <button class="nav-btn" onclick="nextMonth()">▶</button>
    </div>

    ${calendarHtml}

    <button class="today-btn" onclick="goToToday()">Today's Journal</button>

    <div class="stats">${entries.length} entries this month</div>

    <script>
        const vscode = acquireVsCodeApi();

        function openDate(year, month, day) {
            vscode.postMessage({ command: 'openDate', year, month, day });
        }

        function prevMonth() {
            vscode.postMessage({ command: 'prevMonth' });
        }

        function nextMonth() {
            vscode.postMessage({ command: 'nextMonth' });
        }

        function goToToday() {
            vscode.postMessage({ command: 'today' });
        }
    </script>
</body>
</html>`;
    }
}
