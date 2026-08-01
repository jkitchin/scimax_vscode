/**
 * VS Code glue for LaTeX build profiles
 *
 * Reads profiles from settings and from `latex-profiles.json` files near the
 * document, resolves which one a document wants, and runs it with progress and
 * logging. The profile mechanics themselves live in `buildProfiles.ts`.
 *
 * Security note: profiles name executables to run, so project-local profile
 * files are only honored in a trusted workspace. Settings-defined and built-in
 * profiles are always available.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    BuildProfile,
    BuildResult,
    LoadedProfiles,
    loadBuildProfiles,
    resolveBuildProfile,
    runBuildProfile,
    readBuildKeywords,
    EXAMPLE_PROFILES_FILE,
} from './buildProfiles';

// Re-exported so callers of this module get the whole build-profile surface
export { readBuildKeywords };
import { getScimaxDirectory } from '../utils/pathResolver';
import { createLogger } from '../utils/logger';

const log = createLogger('LaTeX Build');

/** Where the user's global profiles file lives */
function getGlobalProfilesPath(): string {
    return path.join(getScimaxDirectory(), 'latex-profiles.json');
}

/** Workspace folder containing `filePath`, used to stop the upward search */
function getWorkspaceRoot(filePath: string): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    return folder?.uri.fsPath;
}

/**
 * Every build profile visible to a document.
 */
export function getProfilesForDocument(documentPath: string): LoadedProfiles {
    const config = vscode.workspace.getConfiguration('scimax.export.pdf');
    return loadBuildProfiles({
        startDir: path.dirname(documentPath),
        stopDir: getWorkspaceRoot(documentPath),
        settingsProfiles: config.get<Record<string, unknown>>('profiles', {}),
        extraFiles: [getGlobalProfilesPath()],
        // Project files can name arbitrary executables - require workspace trust
        includeLocalFiles: vscode.workspace.isTrusted,
    });
}

/**
 * Decide which profile (if any) should build a document.
 *
 * Returns undefined when the built-in compiler settings should be used, and
 * warns once if the document names a profile that does not exist.
 */
export function resolveProfileForDocument(
    documentPath: string,
    keywords?: Record<string, string>
): BuildProfile | undefined {
    const loaded = getProfilesForDocument(documentPath);
    const settingDefault = vscode.workspace
        .getConfiguration('scimax.export.pdf')
        .get<string>('profile', '');

    const resolved = resolveBuildProfile(loaded, keywords, settingDefault);

    if (resolved.unknown) {
        const names = Object.keys(loaded.profiles).sort().join(', ');
        vscode.window.showWarningMessage(
            `Unknown LaTeX build profile "${resolved.requested}" - using the compiler settings instead. Available: ${names}`
        );
        return undefined;
    }

    return resolved.profile;
}

/**
 * Run a profile, streaming step progress into the notification and the log.
 */
export async function runProfile(
    profile: BuildProfile,
    texPath: string,
    outDir?: string,
    progress?: vscode.Progress<{ message?: string }>
): Promise<BuildResult> {
    log.info(`Building ${path.basename(texPath)} with profile "${profile.name}"`, {
        source: profile.source,
        steps: profile.steps.length,
    });

    const result = await runBuildProfile(profile, {
        texPath,
        outDir,
        onProgress: (message) => {
            progress?.report({ message });
            log.debug(message);
        },
    });

    for (const step of result.steps) {
        if (step.skipped) {
            log.debug(`Skipped ${step.label}: ${step.skipReason}`);
        } else if (step.error) {
            log.warn(`${step.label} could not run: ${step.error}`);
        } else if ((step.exitCode ?? 0) !== 0) {
            log.debug(`${step.label} exited with code ${step.exitCode}`);
        }
    }

    // A missing executable is the one failure worth surfacing directly: nothing
    // downstream will explain why the PDF never appeared.
    const missing = result.steps.find(s => s.error);
    if (missing) {
        vscode.window.showErrorMessage(
            `LaTeX build step "${missing.label}" could not run: ${missing.error}`
        );
    }

    return result;
}

/**
 * Short description of the active profile for progress messages, or undefined
 * when no profile applies.
 */
export function describeProfile(profile: BuildProfile | undefined): string | undefined {
    if (!profile) return undefined;
    return `profile "${profile.name}"`;
}

// =============================================================================
// Commands
// =============================================================================

/**
 * Pick a build profile and record it in the document as `#+LATEX_BUILD:`.
 */
async function selectBuildProfile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No file open');
        return;
    }

    const documentPath = editor.document.uri.fsPath;
    const loaded = getProfilesForDocument(documentPath);
    const entries = Object.values(loaded.profiles).sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
    );

    const items: (vscode.QuickPickItem & { profileName?: string })[] = entries.map(profile => ({
        label: `$(gear) ${profile.name}`,
        description: profile.description,
        detail: `${profile.steps.length} step(s) - ${profile.source === 'built-in' ? 'built-in' : profile.source}`,
        profileName: profile.name,
    }));

    items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        {
            label: '$(circle-slash) none',
            description: 'Use the scimax.export.pdf.compiler settings',
            profileName: 'none',
        },
        {
            label: '$(new-file) Create a profiles file...',
            description: 'Write .scimax/latex-profiles.json in this workspace',
        }
    );

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select the LaTeX build profile for this document',
        title: 'LaTeX Build Profile',
    });

    if (!selected) return;

    if (!selected.profileName) {
        await createProfilesFile();
        return;
    }

    await setBuildKeyword(editor, selected.profileName);
}

/**
 * Insert or update `#+LATEX_BUILD:` at the top of the document.
 */
async function setBuildKeyword(editor: vscode.TextEditor, profileName: string): Promise<void> {
    const document = editor.document;
    const isOrg = document.languageId === 'org';
    const keywordLine = isOrg
        ? `#+LATEX_BUILD: ${profileName}`
        : `% !SCIMAX build = ${profileName}`;
    const pattern = isOrg ? /^#\+LATEX_BUILD:/i : /^%\s*!SCIMAX\s+build\s*=/i;

    // Look for an existing declaration in the document's header region
    const headerLines = Math.min(document.lineCount, 30);
    for (let i = 0; i < headerLines; i++) {
        const line = document.lineAt(i);
        if (pattern.test(line.text)) {
            await editor.edit(edit => edit.replace(line.range, keywordLine));
            vscode.window.showInformationMessage(`LaTeX build profile: ${profileName}`);
            return;
        }
    }

    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), `${keywordLine}\n`));
    vscode.window.showInformationMessage(`LaTeX build profile: ${profileName}`);
}

/**
 * Scaffold `.scimax/latex-profiles.json` in the workspace and open it.
 */
async function createProfilesFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const root = editor
        ? getWorkspaceRoot(editor.document.uri.fsPath) ?? path.dirname(editor.document.uri.fsPath)
        : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!root) {
        vscode.window.showWarningMessage('Open a folder or file first');
        return;
    }

    const targetDir = path.join(root, '.scimax');
    const target = path.join(targetDir, 'latex-profiles.json');

    if (fs.existsSync(target)) {
        const doc = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(doc);
        return;
    }

    await fs.promises.mkdir(targetDir, { recursive: true });
    await fs.promises.writeFile(target, JSON.stringify(EXAMPLE_PROFILES_FILE, null, 2), 'utf-8');

    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(
        'Created .scimax/latex-profiles.json - select a profile with #+LATEX_BUILD:'
    );
}

/**
 * Show which profile a document would use and where it came from.
 */
async function showActiveProfile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No file open');
        return;
    }

    const documentPath = editor.document.uri.fsPath;
    const keywords = readBuildKeywords(editor.document.getText());
    const profile = resolveProfileForDocument(documentPath, keywords);

    if (!profile) {
        const compiler = vscode.workspace
            .getConfiguration('scimax.export.pdf')
            .get<string>('compiler', 'latexmk-lualatex');
        vscode.window.showInformationMessage(
            `No build profile active - compiling with scimax.export.pdf.compiler (${compiler})`
        );
        return;
    }

    const steps = profile.steps
        .map(s => s.label || s.command)
        .join(' → ');
    vscode.window.showInformationMessage(
        `Build profile "${profile.name}" (${profile.source}): ${steps}`
    );
}

/**
 * Register the build-profile commands.
 */
export function registerBuildProfileCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.selectBuildProfile', selectBuildProfile),
        vscode.commands.registerCommand('scimax.latex.createBuildProfilesFile', createProfilesFile),
        vscode.commands.registerCommand('scimax.latex.showBuildProfile', showActiveProfile)
    );
}
