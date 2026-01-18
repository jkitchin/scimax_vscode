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
                    this.refresh();
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
                case 'goToMonth':
                    this.currentMonth = message.month;
                    this.refresh();
                    break;
                case 'goToYear':
                    this.currentYear = message.year;
                    this.refresh();
                    break;
                case 'weekView':
                    await vscode.commands.executeCommand('scimax.journal.weekView');
                    break;
                case 'search':
                    await vscode.commands.executeCommand('scimax.journal.search');
                    break;
                case 'stats':
                    await vscode.commands.executeCommand('scimax.journal.stats');
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
        // Get all entries once and derive everything from them (no file reads)
        const allEntries = this.manager.getAllEntries();

        // Filter entries for current month
        const entries = allEntries.filter(e =>
            e.date.getFullYear() === this.currentYear &&
            e.date.getMonth() === this.currentMonth
        );
        const entryDays = new Set(entries.map(e => e.date.getDate()));

        // Pre-compute which months have entries for the current year (for month picker)
        const monthsWithEntries = new Set<number>();
        for (const entry of allEntries) {
            if (entry.date.getFullYear() === this.currentYear) {
                monthsWithEntries.add(entry.date.getMonth());
            }
        }

        // Use basic stats (no file reads - just counts and streaks from dates)
        const totalStats = this.manager.getBasicStats(allEntries);

        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const today = new Date();
        const isCurrentMonth = today.getFullYear() === this.currentYear &&
                               today.getMonth() === this.currentMonth;

        // Build calendar grid
        const firstDay = new Date(this.currentYear, this.currentMonth, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
        const startDayOfWeek = firstDay.getDay();
        const daysInMonth = lastDay.getDate();

        let calendarHtml = '';

        // Header row (weekdays)
        const config = this.manager.getConfig();
        let dayHeaders = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
        if (config.weekStartsOn === 'monday') {
            dayHeaders = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
        }

        calendarHtml += '<div class="calendar-header">';
        for (const day of dayHeaders) {
            calendarHtml += `<div class="day-header">${day}</div>`;
        }
        calendarHtml += '</div>';

        // Day cells
        calendarHtml += '<div class="calendar-grid">';

        // Adjust start day for Monday start
        let adjustedStartDay = startDayOfWeek;
        if (config.weekStartsOn === 'monday') {
            adjustedStartDay = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
        }

        // Empty cells before first day
        for (let i = 0; i < adjustedStartDay; i++) {
            calendarHtml += '<div class="day empty"></div>';
        }

        // Day cells
        for (let day = 1; day <= daysInMonth; day++) {
            const hasEntry = entryDays.has(day);
            const isToday = isCurrentMonth && day === today.getDate();
            const isPast = new Date(this.currentYear, this.currentMonth, day) < today;

            let classes = 'day';
            if (hasEntry) classes += ' has-entry';
            if (isToday) classes += ' today';
            if (isPast && !hasEntry && !isToday) classes += ' past-no-entry';

            const tooltip = hasEntry ? 'Click to open entry' : 'Click to create entry';
            calendarHtml += `<div class="${classes}" onclick="openDate(${this.currentYear}, ${this.currentMonth}, ${day})" title="${tooltip}">${day}</div>`;
        }

        calendarHtml += '</div>';

        // Month picker (uses pre-computed monthsWithEntries - no additional calls)
        let monthPickerHtml = '<div class="month-picker">';
        for (let m = 0; m < 12; m++) {
            const isActive = m === this.currentMonth;
            const hasEntries = monthsWithEntries.has(m);
            let mClass = 'month-btn';
            if (isActive) mClass += ' active';
            if (hasEntries) mClass += ' has-entries';
            monthPickerHtml += `<button class="${mClass}" onclick="goToMonth(${m})">${monthNamesShort[m]}</button>`;
        }
        monthPickerHtml += '</div>';

        // Stats summary
        const streakText = totalStats.streak > 0
            ? `🔥 ${totalStats.streak} day streak`
            : '';

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
            margin-bottom: 8px;
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
            cursor: pointer;
        }

        .month-year:hover {
            text-decoration: underline;
        }

        .year-nav {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .year-btn {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 2px 6px;
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
            margin-bottom: 12px;
        }

        .month-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 0.8em;
        }

        .month-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .month-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .month-btn.has-entries {
            font-weight: bold;
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
            position: relative;
        }

        .day:hover:not(.empty) {
            background: var(--vscode-list-hoverBackground);
        }

        .day.empty {
            cursor: default;
        }

        .day.has-entry {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }

        .day.has-entry::after {
            content: '';
            display: block;
            width: 4px;
            height: 4px;
            background: var(--vscode-textLink-foreground);
            border-radius: 50%;
            margin: 2px auto 0;
        }

        .day.has-entry:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .day.today {
            border: 2px solid var(--vscode-focusBorder);
            padding: 4px 2px;
        }

        .day.past-no-entry {
            opacity: 0.5;
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
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            text-align: center;
        }

        .streak {
            margin-top: 8px;
            font-size: 0.9em;
            text-align: center;
            color: var(--vscode-charts-orange);
        }

        .quick-actions {
            margin-top: 12px;
            display: flex;
            gap: 4px;
        }

        .quick-action {
            flex: 1;
            padding: 6px;
            font-size: 0.8em;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            cursor: pointer;
            border-radius: 3px;
        }

        .quick-action:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div class="nav">
        <button class="nav-btn" onclick="prevMonth()">◀</button>
        <span class="month-year" onclick="toggleMonthPicker()" title="Click to pick month">${monthNames[this.currentMonth]} ${this.currentYear}</span>
        <button class="nav-btn" onclick="nextMonth()">▶</button>
    </div>

    <div class="year-nav">
        <button class="year-btn" onclick="goToYear(${this.currentYear - 2})">${this.currentYear - 2}</button>
        <button class="year-btn" onclick="goToYear(${this.currentYear - 1})">${this.currentYear - 1}</button>
        <button class="year-btn active">${this.currentYear}</button>
        <button class="year-btn" onclick="goToYear(${this.currentYear + 1})">${this.currentYear + 1}</button>
    </div>

    <div id="monthPicker" style="display: none;">
        ${monthPickerHtml}
    </div>

    ${calendarHtml}

    <button class="today-btn" onclick="goToToday()">Today's Journal</button>

    ${streakText ? `<div class="streak">${streakText}</div>` : ''}

    <div class="stats">
        ${entries.length} entries this month · ${totalStats.entryCount} total
    </div>

    <div class="quick-actions">
        <button class="quick-action" onclick="weekView()">This Week</button>
        <button class="quick-action" onclick="search()">Search</button>
        <button class="quick-action" onclick="stats()">Stats</button>
    </div>

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

        function weekView() {
            vscode.postMessage({ command: 'weekView' });
        }

        function search() {
            vscode.postMessage({ command: 'search' });
        }

        function stats() {
            vscode.postMessage({ command: 'stats' });
        }
    </script>
</body>
</html>`;
    }
}
