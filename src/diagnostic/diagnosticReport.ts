/**
 * Diagnostic Report Generator
 * Collects system, VS Code, and scimax configuration information for debugging
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { getDatabase, isDatabaseInitialized } from '../database/lazyDb';

/**
 * Result of checking an executable
 */
export interface ExecutableInfo {
    name: string;
    displayName: string;
    found: boolean;
    version?: string;
    path?: string;
    purpose: string;
}

/**
 * Jupyter kernel information
 */
export interface JupyterKernelInfo {
    name: string;
    displayName: string;
    language: string;
    path: string;
}

/**
 * Database status information
 */
export interface DatabaseInfo {
    location: string;
    exists: boolean;
    sizeBytes?: number;
    sizeFormatted?: string;
    // Stats from database
    stats?: {
        files: number;
        headings: number;
        blocks: number;
        chunks: number;
        hasEmbeddings: boolean;
        vectorSearchSupported: boolean;
        vectorSearchError: string | null;
        lastIndexed?: string;
        byType: { org: number; md: number };
    };
    // Schema info
    schema?: {
        currentVersion: number;
        latestVersion: number;
    };
    // Embedding configuration
    embedding?: {
        provider: string;
        model?: string;
        dimensions?: number;
        ollamaUrl?: string;
    };
}

/**
 * Complete diagnostic information
 */
export interface DiagnosticInfo {
    generatedAt: string;
    system: {
        os: string;
        osVersion: string;
        architecture: string;
        nodeVersion: string;
        homeDirectory: string;
        shell: string;
    };
    vscode: {
        version: string;
        extensionVersion: string;
        workspaceFolders: string[];
        userSettingsPath: string;
    };
    executables: {
        available: ExecutableInfo[];
        notFound: ExecutableInfo[];
    };
    jupyterKernels: JupyterKernelInfo[];
    scimaxConfig: Record<string, unknown>;
    database: DatabaseInfo;
}

/**
 * Executable definitions with version check commands
 */
const EXECUTABLES: Array<{
    name: string;
    displayName: string;
    versionArg: string;
    purpose: string;
    alternateNames?: string[];
}> = [
    { name: 'python3', displayName: 'Python 3', versionArg: '--version', purpose: 'Code execution (primary)', alternateNames: ['python'] },
    { name: 'jupyter', displayName: 'Jupyter', versionArg: '--version', purpose: 'Kernel management' },
    { name: 'git', displayName: 'Git', versionArg: '--version', purpose: 'Version control' },
    { name: 'pdflatex', displayName: 'pdfLaTeX', versionArg: '--version', purpose: 'LaTeX compilation' },
    { name: 'latexmk', displayName: 'latexmk', versionArg: '--version', purpose: 'LaTeX build automation' },
    { name: 'xelatex', displayName: 'XeLaTeX', versionArg: '--version', purpose: 'LaTeX compilation (Unicode)' },
    { name: 'lualatex', displayName: 'LuaLaTeX', versionArg: '--version', purpose: 'LaTeX compilation (Lua)' },
    { name: 'biber', displayName: 'Biber', versionArg: '--version', purpose: 'Bibliography processing' },
    { name: 'bibtex', displayName: 'BibTeX', versionArg: '--version', purpose: 'Bibliography processing (legacy)' },
    { name: 'convert', displayName: 'ImageMagick', versionArg: '--version', purpose: 'Image processing' },
    { name: 'synctex', displayName: 'SyncTeX', versionArg: 'help', purpose: 'PDF synchronization' },
    { name: 'kpsewhich', displayName: 'kpsewhich', versionArg: '--version', purpose: 'TeX path lookup' },
    { name: 'node', displayName: 'Node.js', versionArg: '--version', purpose: 'JavaScript execution' },
    { name: 'npm', displayName: 'npm', versionArg: '--version', purpose: 'Package management' },
];

/**
 * Check if an executable exists and get its version
 */
async function checkExecutable(
    name: string,
    versionArg: string,
    displayName: string,
    purpose: string,
    alternateNames?: string[]
): Promise<ExecutableInfo> {
    const namesToTry = [name, ...(alternateNames || [])];

    for (const execName of namesToTry) {
        try {
            const result = await runCommand(execName, [versionArg], 5000);
            if (result.exitCode === 0 || result.stdout || result.stderr) {
                // Parse version from output (first line usually contains version)
                const output = (result.stdout || result.stderr || '').trim();
                const version = extractVersion(output);
                const execPath = await findExecutablePath(execName);

                return {
                    name: execName,
                    displayName,
                    found: true,
                    version: version || output.split('\n')[0].substring(0, 100),
                    path: execPath,
                    purpose,
                };
            }
        } catch {
            // Try next name
        }
    }

    return {
        name,
        displayName,
        found: false,
        purpose,
    };
}

/**
 * Run a command and capture output
 */
function runCommand(
    command: string,
    args: string[],
    timeout: number
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        try {
            const proc = spawn(command, args, {
                timeout,
                shell: false,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                resolve({ exitCode: code, stdout, stderr });
            });

            proc.on('error', () => {
                resolve({ exitCode: null, stdout, stderr });
            });

            // Ensure process is killed on timeout
            setTimeout(() => {
                proc.kill();
            }, timeout);
        } catch {
            resolve({ exitCode: null, stdout: '', stderr: '' });
        }
    });
}

/**
 * Extract version number from command output
 */
function extractVersion(output: string): string | undefined {
    // Common version patterns
    const patterns = [
        /(\d+\.\d+\.\d+[-\w.]*)/,  // 1.2.3 or 1.2.3-beta
        /version\s+(\d+\.\d+[\w.-]*)/i,  // version 1.2
        /v(\d+\.\d+[\w.-]*)/i,  // v1.2
    ];

    for (const pattern of patterns) {
        const match = output.match(pattern);
        if (match) {
            return match[1];
        }
    }
    return undefined;
}

/**
 * Find the full path to an executable
 */
async function findExecutablePath(name: string): Promise<string | undefined> {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
        const result = await runCommand(whichCmd, [name], 5000);
        if (result.exitCode === 0 && result.stdout) {
            return result.stdout.trim().split('\n')[0];
        }
    } catch {
        // Ignore errors
    }
    return undefined;
}

/**
 * Get list of Jupyter kernels
 */
async function getJupyterKernels(): Promise<JupyterKernelInfo[]> {
    const kernels: JupyterKernelInfo[] = [];

    try {
        const result = await runCommand('jupyter', ['kernelspec', 'list', '--json'], 10000);
        if (result.exitCode === 0 && result.stdout) {
            const data = JSON.parse(result.stdout);
            const kernelSpecs = data.kernelspecs || {};

            for (const [name, spec] of Object.entries(kernelSpecs)) {
                const kernelSpec = spec as { spec?: { display_name?: string; language?: string }; resource_dir?: string };
                kernels.push({
                    name,
                    displayName: kernelSpec.spec?.display_name || name,
                    language: kernelSpec.spec?.language || 'unknown',
                    path: kernelSpec.resource_dir || '',
                });
            }
        }
    } catch {
        // Jupyter not available or error parsing
    }

    return kernels;
}

/**
 * All scimax configuration keys (from package.json contributes.configuration)
 */
const SCIMAX_CONFIG_KEYS = [
    // Core
    'directory',
    'email',
    'logLevel',
    // Journal
    'journal.directory',
    'journal.format',
    'journal.template',
    'journal.dateFormat',
    'journal.autoTimestamp',
    'journal.weekStartsOn',
    // Clock
    'clock.showInlineTime',
    // Mark ring
    'mark.ringSize',
    // Database
    'db.includeJournal',
    'db.includeWorkspace',
    'db.includeProjects',
    'db.include',
    'db.exclude',
    'db.autoIndex',
    'db.autoCheckStale',
    'db.staleCheckDelayMs',
    'db.maxReindexPerSync',
    'db.maxNewFilesPerSync',
    'db.queryTimeoutMs',
    'db.maxRetryAttempts',
    'db.maxFileSizeMB',
    'db.embeddingProvider',
    'db.ollamaUrl',
    'db.ollamaModel',
    // Projectile
    'projectile.scanMaxDepth',
    // Literate programming
    'literate.pythonPath',
    'literate.jupyterPath',
    // References
    'ref.bibliographyFiles',
    'ref.pdfDirectory',
    'ref.notesDirectory',
    'ref.defaultCiteStyle',
    'ref.citationSyntax',
    // BibTeX
    'bibtex.keyPattern',
    // Export - LaTeX
    'export.latex.customHeader',
    'export.latex.documentClass',
    'export.latex.classOptions',
    'export.latex.defaultPreamble',
    // Export - PDF
    'export.pdf.compiler',
    'export.pdf.bibtexCommand',
    'export.pdf.extraArgs',
    'export.pdf.openLogOnError',
    'export.pdf.cleanAuxFiles',
    'export.pdf.shellEscape',
    // Export - Editmarks
    'export.editmarkMode',
    // LaTeX preview
    'latexPreview.enabled',
    'latexPreview.cacheEnabled',
    'latexPreview.darkModeAware',
    // LaTeX live preview
    'latexLivePreview.buildOnSave',
    'latexLivePreview.buildOnIdle',
    'latexLivePreview.idleDelay',
    'latexLivePreview.compiler',
    'latexLivePreview.useLatexmk',
    // LaTeX compilation
    'latex.compiler',
    'latex.pdfViewer',
    'latex.enableChktex',
    'latex.latexmkEngine',
    'latex.validateReferences',
    'latex.formatOnSave',
    'latex.autoCompileOnSave',
    'latex.latexindentPath',
    'latex.showSyncDebugPopup',
    'latex.imagePreviewMaxWidth',
    // Notebook
    'notebook.directory',
    'notebook.defaultTemplate',
    'notebook.autoDetect',
    // Hydra
    'hydra.showKeyHints',
    'hydra.singleKeySelection',
    'hydra.dimNonMatching',
    'hydra.sortByKey',
    // Speed commands
    'speedCommands.enabled',
    // Agenda
    'agenda.includeJournal',
    'agenda.includeWorkspace',
    'agenda.includeProjects',
    'agenda.include',
    'agenda.exclude',
    'agenda.defaultSpan',
    'agenda.showDone',
    'agenda.showHabits',
    'agenda.requireTodoState',
    'agenda.todoStates',
    'agenda.doneStates',
    'agenda.maxFiles',
    'agenda.batchSize',
    'agenda.batchDelayMs',
    // Image overlays
    'imageOverlays.enabled',
    'imageOverlays.maxWidth',
    'imageOverlays.maxHeight',
    'imageOverlays.renderMode',
];

/**
 * Get scimax configuration settings
 */
function getScimaxConfig(): Record<string, unknown> {
    const config = vscode.workspace.getConfiguration('scimax');
    const result: Record<string, unknown> = {};

    for (const key of SCIMAX_CONFIG_KEYS) {
        const inspection = config.inspect(key);
        if (inspection) {
            // Only include if not at default value, or if it's a commonly checked setting
            const isDefault = inspection.globalValue === undefined &&
                              inspection.workspaceValue === undefined &&
                              inspection.workspaceFolderValue === undefined;

            const value = config.get(key);

            // Mask sensitive values
            if (key.toLowerCase().includes('apikey') ||
                key.toLowerCase().includes('secret') ||
                key.toLowerCase().includes('token')) {
                result[key] = value ? '***' : '(not set)';
            } else if (!isDefault || isImportantSetting(key)) {
                // Include non-default values and important settings
                result[key] = value;
            }
        }
    }

    return result;
}

/**
 * Check if a setting is important enough to always show
 */
function isImportantSetting(key: string): boolean {
    const importantKeys = [
        'directory',
        'journal.directory',
        'db.embeddingProvider',
        'literate.pythonPath',
        'literate.jupyterPath',
        'export.pdf.compiler',
        'ref.bibliographyFiles',
        'latex.compiler',
        'latex.pdfViewer',
        'speedCommands.enabled',
        'logLevel',
    ];
    return importantKeys.includes(key);
}

/**
 * Get database information including stats and embedding config
 */
async function getDatabaseInfo(context: vscode.ExtensionContext): Promise<DatabaseInfo> {
    const dbPath = path.join(context.globalStorageUri.fsPath, 'scimax-db.sqlite');
    const info: DatabaseInfo = {
        location: dbPath,
        exists: false,
    };

    // Get file size
    try {
        const fileStats = fs.statSync(dbPath);
        info.exists = true;
        info.sizeBytes = fileStats.size;
        info.sizeFormatted = formatBytes(fileStats.size);
    } catch {
        // Database doesn't exist yet
    }

    // Get embedding configuration
    const config = vscode.workspace.getConfiguration('scimax.db');
    const provider = config.get<string>('embeddingProvider') || 'none';
    info.embedding = {
        provider,
    };

    if (provider === 'ollama') {
        info.embedding.model = config.get<string>('ollamaModel') || 'nomic-embed-text';
        info.embedding.ollamaUrl = config.get<string>('ollamaUrl') || 'http://localhost:11434';
        info.embedding.dimensions = getEmbeddingDimensions(info.embedding.model, provider);
    }

    // Get database stats if initialized (don't force initialization)
    if (isDatabaseInitialized()) {
        try {
            const db = await getDatabase();
            if (db) {
                const dbStats = await db.getStats();
                info.stats = {
                    files: dbStats.files,
                    headings: dbStats.headings,
                    blocks: dbStats.blocks,
                    chunks: dbStats.chunks,
                    hasEmbeddings: dbStats.has_embeddings,
                    vectorSearchSupported: dbStats.vector_search_supported,
                    vectorSearchError: dbStats.vector_search_error,
                    lastIndexed: dbStats.last_indexed
                        ? new Date(dbStats.last_indexed).toLocaleString()
                        : undefined,
                    byType: dbStats.by_type,
                };

                const schemaInfo = await db.getSchemaInfo();
                info.schema = {
                    currentVersion: schemaInfo.currentVersion,
                    latestVersion: schemaInfo.latestVersion,
                };
            }
        } catch {
            // Database not available
        }
    }

    return info;
}

/**
 * Get embedding dimensions for a model
 */
function getEmbeddingDimensions(model: string, provider: string): number {
    if (provider === 'ollama') {
        const dims: Record<string, number> = {
            'nomic-embed-text': 768,
            'all-minilm': 384,
            'mxbai-embed-large': 1024,
            'snowflake-arctic-embed': 1024,
        };
        return dims[model] || 768;
    }
    return 0;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Get OS display name
 */
function getOsDisplayName(): string {
    switch (process.platform) {
        case 'darwin': return 'macOS';
        case 'win32': return 'Windows';
        case 'linux': return 'Linux';
        default: return process.platform;
    }
}

/**
 * Get extension version from package.json
 */
function getExtensionVersion(context: vscode.ExtensionContext): string {
    try {
        const packageJsonPath = path.join(context.extensionPath, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        return packageJson.version || 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * Get user settings path
 */
function getUserSettingsPath(): string {
    const homeDir = os.homedir();
    switch (process.platform) {
        case 'darwin':
            return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
        case 'win32':
            return path.join(process.env.APPDATA || '', 'Code', 'User', 'settings.json');
        default:
            return path.join(homeDir, '.config', 'Code', 'User', 'settings.json');
    }
}

/**
 * Gather all diagnostic information
 */
export async function gatherDiagnosticInfo(context: vscode.ExtensionContext): Promise<DiagnosticInfo> {
    // Check all executables in parallel
    const executablePromises = EXECUTABLES.map((exec) =>
        checkExecutable(exec.name, exec.versionArg, exec.displayName, exec.purpose, exec.alternateNames)
    );

    const [executableResults, jupyterKernels, databaseInfo] = await Promise.all([
        Promise.all(executablePromises),
        getJupyterKernels(),
        getDatabaseInfo(context),
    ]);

    const available = executableResults.filter((e) => e.found);
    const notFound = executableResults.filter((e) => !e.found);

    return {
        generatedAt: new Date().toISOString(),
        system: {
            os: getOsDisplayName(),
            osVersion: `${os.type()} ${os.release()}`,
            architecture: os.arch(),
            nodeVersion: process.version,
            homeDirectory: os.homedir(),
            shell: process.env.SHELL || process.env.COMSPEC || 'unknown',
        },
        vscode: {
            version: vscode.version,
            extensionVersion: getExtensionVersion(context),
            workspaceFolders: vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) || [],
            userSettingsPath: getUserSettingsPath(),
        },
        executables: {
            available,
            notFound,
        },
        jupyterKernels,
        scimaxConfig: getScimaxConfig(),
        database: databaseInfo,
    };
}

/**
 * Format diagnostic info as markdown report
 */
export function formatReportAsMarkdown(info: DiagnosticInfo): string {
    const lines: string[] = [];

    lines.push('# Scimax Diagnostic Report');
    lines.push('');
    lines.push(`Generated: ${new Date(info.generatedAt).toLocaleString()}`);
    lines.push('');

    // System Information
    lines.push('## System Information');
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('|----------|-------|');
    lines.push(`| OS | ${info.system.os} |`);
    lines.push(`| OS Version | ${info.system.osVersion} |`);
    lines.push(`| Architecture | ${info.system.architecture} |`);
    lines.push(`| Node.js | ${info.system.nodeVersion} |`);
    lines.push(`| Home Directory | \`${info.system.homeDirectory}\` |`);
    lines.push(`| Shell | \`${info.system.shell}\` |`);
    lines.push('');

    // VS Code Information
    lines.push('## VS Code');
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('|----------|-------|');
    lines.push(`| VS Code Version | ${info.vscode.version} |`);
    lines.push(`| Scimax Extension | ${info.vscode.extensionVersion} |`);
    lines.push(`| User Settings | \`${info.vscode.userSettingsPath}\` |`);
    if (info.vscode.workspaceFolders.length > 0) {
        lines.push(`| Workspace Folders | ${info.vscode.workspaceFolders.length} |`);
        for (const folder of info.vscode.workspaceFolders) {
            lines.push(`| | \`${folder}\` |`);
        }
    } else {
        lines.push('| Workspace Folders | (none) |');
    }
    lines.push('');

    // External Programs - Available
    lines.push('## External Programs');
    lines.push('');
    if (info.executables.available.length > 0) {
        lines.push('### Available');
        lines.push('');
        lines.push('| Program | Version | Path |');
        lines.push('|---------|---------|------|');
        for (const exec of info.executables.available) {
            const version = exec.version?.substring(0, 50) || 'unknown';
            const execPath = exec.path ? `\`${exec.path}\`` : '-';
            lines.push(`| ${exec.displayName} | ${version} | ${execPath} |`);
        }
        lines.push('');
    }

    // External Programs - Not Found
    if (info.executables.notFound.length > 0) {
        lines.push('### Not Found');
        lines.push('');
        for (const exec of info.executables.notFound) {
            lines.push(`- **${exec.displayName}** (\`${exec.name}\`) - ${exec.purpose}`);
        }
        lines.push('');
    }

    // Jupyter Kernels
    lines.push('## Jupyter Kernels');
    lines.push('');
    if (info.jupyterKernels.length > 0) {
        lines.push('| Name | Language | Path |');
        lines.push('|------|----------|------|');
        for (const kernel of info.jupyterKernels) {
            lines.push(`| ${kernel.displayName} | ${kernel.language} | \`${kernel.path}\` |`);
        }
    } else {
        lines.push('No Jupyter kernels found. Install kernels with:');
        lines.push('```bash');
        lines.push('pip install ipykernel');
        lines.push('python -m ipykernel install --user');
        lines.push('```');
    }
    lines.push('');

    // Scimax Configuration - grouped by category
    lines.push('## Scimax Configuration');
    lines.push('');
    const configEntries = Object.entries(info.scimaxConfig);
    if (configEntries.length > 0) {
        // Group settings by category (first part of key)
        // Note: Database settings are shown in the consolidated Database section
        const categories: Record<string, Array<[string, unknown]>> = {
            'Core': [],
            'Journal': [],
            'References': [],
            'Export': [],
            'LaTeX': [],
            'Agenda': [],
            'Other': [],
        };

        for (const [key, value] of configEntries) {
            if (key.startsWith('journal.') || key === 'clock.showInlineTime') {
                categories['Journal'].push([key, value]);
            } else if (key.startsWith('db.')) {
                // Skip - shown in Database section
                continue;
            } else if (key.startsWith('ref.') || key.startsWith('bibtex.')) {
                categories['References'].push([key, value]);
            } else if (key.startsWith('export.')) {
                categories['Export'].push([key, value]);
            } else if (key.startsWith('latex') || key.startsWith('latexPreview') || key.startsWith('latexLivePreview')) {
                categories['LaTeX'].push([key, value]);
            } else if (key.startsWith('agenda.')) {
                categories['Agenda'].push([key, value]);
            } else if (['directory', 'email', 'logLevel'].includes(key)) {
                categories['Core'].push([key, value]);
            } else {
                categories['Other'].push([key, value]);
            }
        }

        // Output each category
        for (const [category, entries] of Object.entries(categories)) {
            if (entries.length === 0) continue;

            lines.push(`### ${category}`);
            lines.push('');
            lines.push('| Setting | Value |');
            lines.push('|---------|-------|');
            for (const [key, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
                let displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                // Truncate very long values
                if (displayValue.length > 80) {
                    displayValue = displayValue.substring(0, 77) + '...';
                }
                lines.push(`| \`scimax.${key}\` | ${displayValue} |`);
            }
            lines.push('');
        }
    } else {
        lines.push('All settings at default values.');
    }
    lines.push('');

    // Database - consolidated section
    lines.push('## Database');
    lines.push('');

    // Basic info
    lines.push('### Storage');
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('|----------|-------|');
    lines.push(`| Location | \`${info.database.location}\` |`);
    lines.push(`| Status | ${info.database.exists ? 'Exists' : 'Not created'} |`);
    if (info.database.exists && info.database.sizeFormatted) {
        lines.push(`| Size | ${info.database.sizeFormatted} |`);
    }
    if (info.database.schema) {
        lines.push(`| Schema Version | ${info.database.schema.currentVersion} / ${info.database.schema.latestVersion} |`);
    }
    lines.push('');

    // Stats (only if database is initialized and has data)
    if (info.database.stats) {
        lines.push('### Content');
        lines.push('');
        lines.push('| Type | Count |');
        lines.push('|------|-------|');
        lines.push(`| Files | ${info.database.stats.files} (${info.database.stats.byType.org} org, ${info.database.stats.byType.md} md) |`);
        lines.push(`| Headings | ${info.database.stats.headings} |`);
        lines.push(`| Source Blocks | ${info.database.stats.blocks} |`);
        lines.push(`| Chunks | ${info.database.stats.chunks} |`);
        if (info.database.stats.lastIndexed) {
            lines.push(`| Last Indexed | ${info.database.stats.lastIndexed} |`);
        }
        lines.push('');
    }

    // Embeddings
    lines.push('### Embeddings');
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('|----------|-------|');
    lines.push(`| Provider | ${info.database.embedding?.provider || 'none'} |`);
    if (info.database.embedding?.model) {
        lines.push(`| Model | ${info.database.embedding.model} |`);
    }
    if (info.database.embedding?.dimensions) {
        lines.push(`| Dimensions | ${info.database.embedding.dimensions} |`);
    }
    if (info.database.embedding?.ollamaUrl) {
        lines.push(`| Ollama URL | ${info.database.embedding.ollamaUrl} |`);
    }
    if (info.database.stats) {
        lines.push(`| Has Embeddings | ${info.database.stats.hasEmbeddings ? 'Yes' : 'No'} |`);
        lines.push(`| Vector Search | ${info.database.stats.vectorSearchSupported ? 'Supported' : 'Not available'} |`);
        if (info.database.stats.vectorSearchError) {
            lines.push(`| Vector Search Error | ${info.database.stats.vectorSearchError} |`);
        }
    }
    lines.push('');

    return lines.join('\n');
}
