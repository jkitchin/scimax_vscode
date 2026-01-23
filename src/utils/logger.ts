/**
 * Centralized Logging System for Scimax
 *
 * Provides structured logging with:
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - VS Code output channel
 * - Visual error indication via status bar
 * - Module-scoped loggers
 */

import * as vscode from 'vscode';

/**
 * Log levels in order of severity
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

/**
 * Map string config values to LogLevel
 */
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
    'debug': LogLevel.DEBUG,
    'info': LogLevel.INFO,
    'warn': LogLevel.WARN,
    'error': LogLevel.ERROR
};

/**
 * Error entry for tracking recent errors
 */
interface ErrorEntry {
    timestamp: number;
    module: string;
    message: string;
    error?: Error;
}

/**
 * Global logging state
 */
class LoggingService {
    private outputChannel: vscode.OutputChannel | null = null;
    private statusBarItem: vscode.StatusBarItem | null = null;
    private errorCount: number = 0;
    private recentErrors: ErrorEntry[] = [];
    private maxRecentErrors: number = 50;
    private configuredLevel: LogLevel = LogLevel.INFO;
    private disposables: vscode.Disposable[] = [];

    /**
     * Initialize the logging service
     * Must be called during extension activation
     */
    initialize(context: vscode.ExtensionContext): void {
        // Create output channel
        this.outputChannel = vscode.window.createOutputChannel('Scimax', { log: true });
        context.subscriptions.push(this.outputChannel);

        // Create status bar item for error indicator
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            50
        );
        this.statusBarItem.command = 'scimax.showErrorLog';
        context.subscriptions.push(this.statusBarItem);

        // Load configuration
        this.loadConfiguration();

        // Watch for configuration changes
        const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scimax.logLevel')) {
                this.loadConfiguration();
            }
        });
        this.disposables.push(configWatcher);
        context.subscriptions.push(configWatcher);

        // Register command to show error log
        const showErrorLogCommand = vscode.commands.registerCommand(
            'scimax.showErrorLog',
            () => this.showErrorLog()
        );
        context.subscriptions.push(showErrorLogCommand);

        // Register command to clear errors
        const clearErrorsCommand = vscode.commands.registerCommand(
            'scimax.clearErrors',
            () => this.clearErrors()
        );
        context.subscriptions.push(clearErrorsCommand);

        // Register command to copy diagnostic report
        const copyDiagnosticsCommand = vscode.commands.registerCommand(
            'scimax.copyDiagnostics',
            () => this.copyDiagnosticReport()
        );
        context.subscriptions.push(copyDiagnosticsCommand);

        // Register command to show diagnostic report
        const showDiagnosticsCommand = vscode.commands.registerCommand(
            'scimax.showDiagnostics',
            () => this.showDiagnosticReport()
        );
        context.subscriptions.push(showDiagnosticsCommand);

        // Register command to report issue on GitHub
        const reportIssueCommand = vscode.commands.registerCommand(
            'scimax.reportIssue',
            () => this.reportIssue()
        );
        context.subscriptions.push(reportIssueCommand);

        this.log(LogLevel.INFO, 'Logger', 'Logging service initialized');
    }

    /**
     * Load log level from configuration
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('scimax');
        const levelStr = config.get<string>('logLevel', 'info').toLowerCase();
        this.configuredLevel = LOG_LEVEL_MAP[levelStr] ?? LogLevel.INFO;
    }

    /**
     * Get the configured log level
     */
    getConfiguredLevel(): LogLevel {
        return this.configuredLevel;
    }

    /**
     * Check if a log level should be output
     */
    shouldLog(level: LogLevel): boolean {
        // Errors are always logged regardless of configured level
        if (level === LogLevel.ERROR) {
            return true;
        }
        return level >= this.configuredLevel;
    }

    /**
     * Format a log message
     */
    private formatMessage(level: LogLevel, module: string, message: string, data?: object): string {
        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level].padEnd(5);
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        return `[${timestamp}] [${levelStr}] [${module}] ${message}${dataStr}`;
    }

    /**
     * Log a message
     */
    log(level: LogLevel, module: string, message: string, data?: object): void {
        if (!this.shouldLog(level)) {
            return;
        }

        const formatted = this.formatMessage(level, module, message, data);

        // Always output to channel if available
        if (this.outputChannel) {
            switch (level) {
                case LogLevel.DEBUG:
                    this.outputChannel.appendLine(formatted);
                    break;
                case LogLevel.INFO:
                    this.outputChannel.appendLine(formatted);
                    break;
                case LogLevel.WARN:
                    this.outputChannel.appendLine(formatted);
                    break;
                case LogLevel.ERROR:
                    this.outputChannel.appendLine(formatted);
                    break;
            }
        }

        // Also log to console for development
        switch (level) {
            case LogLevel.DEBUG:
                console.debug(formatted);
                break;
            case LogLevel.INFO:
                console.log(formatted);
                break;
            case LogLevel.WARN:
                console.warn(formatted);
                break;
            case LogLevel.ERROR:
                console.error(formatted);
                break;
        }
    }

    /**
     * Log an error and update visual indicator
     */
    logError(module: string, message: string, error?: Error, data?: object): void {
        // Log the error message
        this.log(LogLevel.ERROR, module, message, data);

        // Log stack trace if available
        if (error?.stack) {
            this.outputChannel?.appendLine(`  Stack: ${error.stack}`);
        }

        // Track the error
        this.errorCount++;
        this.recentErrors.push({
            timestamp: Date.now(),
            module,
            message: error ? `${message}: ${error.message}` : message,
            error
        });

        // Trim old errors
        while (this.recentErrors.length > this.maxRecentErrors) {
            this.recentErrors.shift();
        }

        // Update status bar
        this.updateStatusBar();
    }

    /**
     * Update the status bar error indicator
     */
    private updateStatusBar(): void {
        if (!this.statusBarItem) {
            return;
        }

        if (this.errorCount > 0) {
            this.statusBarItem.text = `$(error) ${this.errorCount} error${this.errorCount > 1 ? 's' : ''}`;
            this.statusBarItem.tooltip = `Scimax: ${this.errorCount} error(s) occurred. Click to view.`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    /**
     * Show the error log in a quick pick
     */
    private async showErrorLog(): Promise<void> {
        if (this.recentErrors.length === 0) {
            vscode.window.showInformationMessage('No recent errors.');
            return;
        }

        const items = this.recentErrors.map((entry, index) => ({
            label: `$(error) [${entry.module}] ${entry.message}`,
            description: new Date(entry.timestamp).toLocaleTimeString(),
            detail: entry.error?.stack?.split('\n')[1]?.trim(),
            index
        })).reverse(); // Most recent first

        const options: vscode.QuickPickItem[] = [
            { label: '$(output) Show Output Channel', description: 'View full log' },
            { label: '$(clear-all) Clear All Errors', description: 'Reset error count' },
            { kind: vscode.QuickPickItemKind.Separator, label: 'Recent Errors' },
            ...items
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `${this.errorCount} error(s) - Select an action or error to view details`
        });

        if (!selected) {
            return;
        }

        if (selected.label.includes('Show Output Channel')) {
            this.outputChannel?.show();
        } else if (selected.label.includes('Clear All Errors')) {
            this.clearErrors();
        } else if ('index' in selected) {
            // Show error details
            const entry = this.recentErrors[(selected as any).index];
            if (entry) {
                const detail = [
                    `Module: ${entry.module}`,
                    `Time: ${new Date(entry.timestamp).toLocaleString()}`,
                    `Message: ${entry.message}`,
                    entry.error?.stack ? `\nStack Trace:\n${entry.error.stack}` : ''
                ].join('\n');

                const action = await vscode.window.showErrorMessage(
                    entry.message,
                    { modal: false, detail },
                    'Show Full Log',
                    'Copy Error'
                );

                if (action === 'Show Full Log') {
                    this.outputChannel?.show();
                } else if (action === 'Copy Error') {
                    await vscode.env.clipboard.writeText(detail);
                    vscode.window.showInformationMessage('Error details copied to clipboard');
                }
            }
        }
    }

    /**
     * Clear all tracked errors
     */
    clearErrors(): void {
        this.errorCount = 0;
        this.recentErrors = [];
        this.updateStatusBar();
        this.log(LogLevel.INFO, 'Logger', 'Error log cleared');
    }

    /**
     * Get recent errors for diagnostics
     */
    getRecentErrors(): ErrorEntry[] {
        return [...this.recentErrors];
    }

    /**
     * Get error count
     */
    getErrorCount(): number {
        return this.errorCount;
    }

    /**
     * Show the output channel
     */
    show(): void {
        this.outputChannel?.show();
    }

    /**
     * Generate a diagnostic report for debugging
     * Formatted for easy copying to Claude or issue reports
     */
    async generateDiagnosticReport(): Promise<string> {
        const lines: string[] = [
            '# Scimax Diagnostic Report',
            `Generated: ${new Date().toISOString()}`,
            '',
            '> **Privacy Note**: This report may contain file paths and other potentially',
            '> sensitive information. Review before sharing publicly.',
            '',
            '## Environment',
            `- VS Code Version: ${vscode.version}`,
            `- Extension Version: ${vscode.extensions.getExtension('scimax.scimax-vscode')?.packageJSON?.version || 'unknown'}`,
            `- Platform: ${process.platform}`,
            `- Node Version: ${process.version}`,
            `- Log Level: ${LogLevel[this.configuredLevel]}`,
            ''
        ];

        // Database stats if available
        try {
            const { getDatabase } = await import('../database/lazyDb');
            const db = await getDatabase();
            if (db) {
                const stats = await db.getStats();
                const schemaInfo = await db.getSchemaInfo();
                lines.push(
                    '## Database',
                    `- Schema Version: ${schemaInfo.currentVersion}/${schemaInfo.latestVersion}`,
                    `- Files Indexed: ${stats.files} (org: ${stats.by_type.org}, md: ${stats.by_type.md})`,
                    `- Headings: ${stats.headings}`,
                    `- Source Blocks: ${stats.blocks}`,
                    `- Links: ${stats.links}`,
                    `- Vector Search: ${stats.vector_search_supported ? 'available' : 'not available'}${stats.vector_search_error ? ` (${stats.vector_search_error})` : ''}`,
                    `- Embeddings: ${stats.has_embeddings ? 'yes' : 'no'}`,
                    ''
                );
            } else {
                lines.push('## Database', '- Status: Not initialized', '');
            }
        } catch (e) {
            lines.push('## Database', `- Status: Error getting stats: ${e}`, '');
        }

        // Error summary
        lines.push(
            '## Errors',
            `- Total Errors: ${this.errorCount}`,
            `- Recent Errors: ${this.recentErrors.length}`,
            ''
        );

        // Recent errors with full details
        if (this.recentErrors.length > 0) {
            lines.push('### Recent Error Details');
            for (const entry of this.recentErrors.slice(-10)) { // Last 10 errors
                lines.push(
                    '',
                    `#### [${entry.module}] ${new Date(entry.timestamp).toISOString()}`,
                    '```',
                    entry.message,
                    entry.error?.stack || '(no stack trace)',
                    '```'
                );
            }
            lines.push('');
        }

        // Configuration
        lines.push('## Configuration');
        const config = vscode.workspace.getConfiguration('scimax');
        const relevantSettings = [
            'logLevel',
            'db.exclude',
            'db.embeddingProvider',
            'db.embeddingModel',
            'journal.directory',
            'babel.defaultLanguage'
        ];
        for (const setting of relevantSettings) {
            const value = config.get(setting);
            if (value !== undefined) {
                lines.push(`- scimax.${setting}: ${JSON.stringify(value)}`);
            }
        }
        lines.push('');

        // Workspace info
        lines.push('## Workspace');
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            lines.push(`- Folders: ${folders.length}`);
            for (const folder of folders) {
                lines.push(`  - ${folder.name}: ${folder.uri.fsPath}`);
            }
        } else {
            lines.push('- No workspace folders open');
        }

        return lines.join('\n');
    }

    /**
     * Copy diagnostic report to clipboard
     */
    async copyDiagnosticReport(): Promise<void> {
        const report = await this.generateDiagnosticReport();
        await vscode.env.clipboard.writeText(report);
        vscode.window.showInformationMessage('Diagnostic report copied to clipboard');
    }

    /**
     * Show diagnostic report in a new document
     */
    async showDiagnosticReport(): Promise<void> {
        const report = await this.generateDiagnosticReport();
        const doc = await vscode.workspace.openTextDocument({
            content: report,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * Open GitHub issue page - lets user review before submitting
     * Note: No automatic logs attached due to privacy concerns
     */
    async reportIssue(): Promise<void> {
        const extensionVersion = vscode.extensions.getExtension('scimax.scimax-vscode')?.packageJSON?.version || 'unknown';

        // Build a minimal issue template (no sensitive data)
        const body = `## Description
<!-- Describe what happened and what you expected -->


## Steps to Reproduce
1.
2.
3.

## Environment
- VS Code Version: ${vscode.version}
- Extension Version: ${extensionVersion}
- Platform: ${process.platform}

## Error Messages (if any)
<!--
If comfortable, paste relevant error messages here.
Use "Scimax: Show Diagnostic Report" to review what info is available.
REVIEW FOR SENSITIVE INFO (file paths, usernames) BEFORE PASTING.
-->


## Additional Context
<!-- Screenshots, relevant configuration, etc. -->
`;

        // URL encode the body
        const encodedBody = encodeURIComponent(body);
        const encodedTitle = encodeURIComponent('[Bug] ');

        // Open GitHub issue page
        const issueUrl = `https://github.com/jkitchin/scimax_vscode/issues/new?title=${encodedTitle}&body=${encodedBody}`;

        const action = await vscode.window.showInformationMessage(
            'Open GitHub to create an issue? You can optionally review diagnostics first.',
            'Open GitHub',
            'Review Diagnostics First',
            'Cancel'
        );

        if (action === 'Open GitHub') {
            await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
        } else if (action === 'Review Diagnostics First') {
            // Show diagnostic report so user can review and selectively copy
            await this.showDiagnosticReport();
            // Then offer to open GitHub
            const proceed = await vscode.window.showInformationMessage(
                'Review the diagnostic report for sensitive info. Ready to open GitHub?',
                'Open GitHub',
                'Cancel'
            );
            if (proceed === 'Open GitHub') {
                await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
            }
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}

// Global singleton instance
const loggingService = new LoggingService();

/**
 * Initialize the logging service - call during extension activation
 */
export function initializeLogging(context: vscode.ExtensionContext): void {
    loggingService.initialize(context);
}

/**
 * Get the logging service instance
 */
export function getLoggingService(): LoggingService {
    return loggingService;
}

/**
 * Module-scoped logger for convenient logging
 */
export class Logger {
    constructor(private module: string) {}

    /**
     * Log a debug message (only when log level is DEBUG)
     */
    debug(message: string, data?: object): void {
        loggingService.log(LogLevel.DEBUG, this.module, message, data);
    }

    /**
     * Log an info message
     */
    info(message: string, data?: object): void {
        loggingService.log(LogLevel.INFO, this.module, message, data);
    }

    /**
     * Log a warning message
     */
    warn(message: string, data?: object): void {
        loggingService.log(LogLevel.WARN, this.module, message, data);
    }

    /**
     * Log an error message with optional Error object
     * Errors are always logged and update the visual indicator
     */
    error(message: string, error?: Error, data?: object): void {
        loggingService.logError(this.module, message, error, data);
    }

    /**
     * Create a child logger with a sub-module name
     */
    child(subModule: string): Logger {
        return new Logger(`${this.module}:${subModule}`);
    }
}

/**
 * Create a logger for a module
 */
export function createLogger(module: string): Logger {
    return new Logger(module);
}

// Pre-created loggers for common modules
export const extensionLogger = createLogger('Extension');
export const databaseLogger = createLogger('Database');
export const parserLogger = createLogger('Parser');
export const babelLogger = createLogger('Babel');
export const journalLogger = createLogger('Journal');
export const projectileLogger = createLogger('Projectile');
export const agendaLogger = createLogger('Agenda');
export const referenceLogger = createLogger('References');
