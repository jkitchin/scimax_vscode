/**
 * Crucible knowledge bases in VS Code: a Crucible panel in the Scimax
 * sidebar, search, and the graph around the open article (back-links,
 * related articles, derivation history).
 *
 * The data comes from the crucible CLI's JSON output (crucibleCli.ts) and
 * the wiki's org files. Opening a crucible article also loads the crucible's
 * references.bib, so its citations resolve, and shows `crucible lint` issues
 * in the Problems panel. Saving an article runs `crucible sync`.
 *
 * Ingesting a file runs `crucible ingest`. Distilling a source is the LLM's
 * work, so Scimax hands it to Claude Code with a prompt naming the source.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ReferenceManager } from '../references/referenceManager';
import { extensionLogger as log } from '../utils/logger';
import { ensureClaudeCode, openClaudeCodeWithPrompt } from '../shared/claudeCode';
import { CrucibleGraphView } from './crucibleGraphView';
import {
    ARTICLE_TYPES, CRUCIBLE_DIR, askPrompt, CrucibleArticle, CrucibleCliError, CrucibleConcept, CrucibleHistory,
    CrucibleGraph, CrucibleLintIssue, CrucibleSource, RegistryEntry, SearchMode, cruciblePaths, distillPrompt, findCrucibleRoot,
    lintIssueRange, listWikiArticles, parseIngestOutput, runCrucible, runCrucibleJson, sourceCiteKey,
} from './crucibleCli';

interface Crucible {
    name: string;
    root: string;
    inWorkspace: boolean;
}

type CrucibleNode =
    | { kind: 'crucible'; crucible: Crucible }
    | { kind: 'concepts'; crucible: Crucible }
    | { kind: 'concept'; crucible: Crucible; concept: CrucibleConcept }
    | { kind: 'type'; crucible: Crucible; dir: string; label: string }
    | { kind: 'article'; file: string; title: string; description?: string; tooltip?: string }
    | { kind: 'message'; text: string };

function config() {
    const c = vscode.workspace.getConfiguration('scimax.crucible');
    return {
        command: c.get<string>('command', 'crucible') || 'crucible',
        searchMode: c.get<SearchMode>('searchMode', 'auto'),
        searchLimit: c.get<number>('searchLimit', 20),
        syncOnSave: c.get<boolean>('syncOnSave', true),
        showLint: c.get<boolean>('showLint', true),
    };
}

function cli<T>(args: string[], cwd: string): Promise<T> {
    return runCrucibleJson<T>(args, { command: config().command, cwd });
}

/** Tell the user a CLI call failed; offer the setting when the CLI is missing. */
async function showCliError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CrucibleCliError && error.notFound) {
        const choice = await vscode.window.showErrorMessage(
            `${message}. Install crucible (pip install crucible-llm) or set scimax.crucible.command to its full path.`,
            'Open Settings');
        if (choice) {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'scimax.crucible.command');
        }
        return;
    }
    vscode.window.showErrorMessage(message);
}

// =============================================================================
// Finding crucibles
// =============================================================================

/** Crucibles in the workspace, then the others in the global registry. */
async function listCrucibles(): Promise<Crucible[]> {
    const crucibles: Crucible[] = [];
    const seen = new Set<string>();
    const add = (crucible: Crucible) => {
        const key = path.resolve(crucible.root);
        if (!seen.has(key) && fs.existsSync(cruciblePaths(crucible.root).wiki)) {
            seen.add(key);
            crucibles.push(crucible);
        }
    };

    let registry: RegistryEntry[] = [];
    try {
        registry = await cli<RegistryEntry[]>(['registry', 'list'], os.homedir());
    } catch (error) {
        if (error instanceof CrucibleCliError && error.notFound) {
            throw error;
        }
        // A registry that cannot be read still leaves the workspace crucibles.
    }
    const registryName = (root: string) =>
        registry.find(entry => path.resolve(entry.path) === path.resolve(root))?.name;

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const root = findCrucibleRoot(folder.uri.fsPath);
        if (root) {
            add({ name: registryName(root) ?? path.basename(root), root, inWorkspace: true });
        }
    }
    for (const entry of registry) {
        add({ name: entry.name, root: entry.path, inWorkspace: false });
    }
    return crucibles;
}

/** The crucible of the active editor's file, if it is in one. */
function activeCrucibleRoot(): string | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return uri?.scheme === 'file' ? findCrucibleRoot(uri.fsPath) : undefined;
}

/**
 * The crucible to act on: the one of the active file, the only one in the
 * workspace, or one the user picks.
 */
async function chooseCrucible(placeHolder: string): Promise<Crucible | undefined> {
    const active = activeCrucibleRoot();
    let crucibles: Crucible[];
    try {
        crucibles = await listCrucibles();
    } catch (error) {
        await showCliError(error);
        return undefined;
    }
    if (active) {
        return crucibles.find(c => path.resolve(c.root) === path.resolve(active))
            ?? { name: path.basename(active), root: active, inWorkspace: false };
    }
    const inWorkspace = crucibles.filter(c => c.inWorkspace);
    if (inWorkspace.length === 1) {
        return inWorkspace[0];
    }
    if (crucibles.length === 0) {
        vscode.window.showInformationMessage('No crucible found. Run `crucible init` in a project to make one.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(
        crucibles.map(c => ({ label: c.name, description: c.inWorkspace ? 'workspace' : '', detail: c.root, crucible: c })),
        { placeHolder, matchOnDetail: true });
    return pick?.crucible;
}

// =============================================================================
// Opening articles
// =============================================================================

interface ArticlePick extends vscode.QuickPickItem {
    file?: string;
}

function articlePick(article: CrucibleArticle, root: string, detail?: string): ArticlePick {
    return {
        label: article.title,
        description: [article.article_type, article._crucible && article._crucible !== 'local' ? article._crucible : '']
            .filter(Boolean).join(' · '),
        detail: detail ?? article.abstract?.slice(0, 200),
        file: path.join(root, article.path),
    };
}

async function openArticleFrom(items: ArticlePick[], placeHolder: string): Promise<void> {
    const pick = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true, matchOnDetail: true });
    if (pick?.file) {
        await vscode.window.showTextDocument(vscode.Uri.file(pick.file));
    }
}

// =============================================================================
// Search
// =============================================================================

/** Opens a graph of a crucible filtered to search results. */
type ShowResultsGraph = (root: string, name: string, query: string, paths: string[]) => Promise<void>;

/** While the search results picker is open: show its results as graphs (M-o). */
let graphSearchResults: (() => void) | undefined;

/** Run M-o in the search results picker. */
function searchResultsGraph(): void {
    graphSearchResults?.();
}

/**
 * Pick a search result to open it, or press M-o to open a graph of each
 * crucible with results, filtered to them.
 */
async function pickSearchResult(items: ArticlePick[], placeHolder: string, graph: () => void): Promise<void> {
    const picker = vscode.window.createQuickPick<ArticlePick>();
    picker.items = items;
    picker.placeholder = `${placeHolder} (M-o: graph of the results)`;
    picker.matchOnDescription = true;
    picker.matchOnDetail = true;
    const file = await new Promise<string | undefined>(resolve => {
        graphSearchResults = () => {
            picker.hide();
            graph();
        };
        void vscode.commands.executeCommand('setContext', 'scimax.cruciblePickerActive', true);
        picker.onDidAccept(() => {
            resolve(picker.selectedItems[0]?.file);
            picker.hide();
        });
        picker.onDidHide(() => {
            graphSearchResults = undefined;
            void vscode.commands.executeCommand('setContext', 'scimax.cruciblePickerActive', false);
            resolve(undefined);
            picker.dispose();
        });
        picker.show();
    });
    if (file) {
        await vscode.window.showTextDocument(vscode.Uri.file(file));
    }
}

async function search(crucible: Crucible | undefined, all: boolean, showGraph: ShowResultsGraph): Promise<void> {
    const target = crucible ?? await chooseCrucible(all ? 'Search from which crucible?' : 'Search which crucible?');
    if (!target) {
        return;
    }
    const query = await vscode.window.showInputBox({
        prompt: all ? 'Search all crucibles' : `Search ${target.name}`,
        placeHolder: 'Words or a question (semantic search needs crucible embed)',
    });
    if (!query?.trim()) {
        return;
    }
    const { searchMode, searchLimit } = config();
    const args = ['search', query, '--mode', searchMode, '--limit', String(searchLimit), ...(all ? ['--all'] : [])];
    let results: CrucibleArticle[];
    let roots = new Map<string, string>();
    try {
        results = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Searching ${all ? 'all crucibles' : target.name}` },
            () => cli<CrucibleArticle[]>(args, target.root));
        if (all) {
            // Peer results are relative to their own crucible.
            const registry = await cli<RegistryEntry[]>(['registry', 'list'], os.homedir());
            roots = new Map(registry.map(entry => [entry.name, entry.path]));
        }
    } catch (error) {
        await showCliError(error);
        return;
    }
    if (results.length === 0) {
        vscode.window.showInformationMessage(`No results for "${query}".`);
        return;
    }
    const rootOf = (article: CrucibleArticle) =>
        (article._crucible && roots.get(article._crucible)) || target.root;
    // One graph per crucible with results.
    const graph = () => {
        const byRoot = new Map<string, { name: string; paths: string[] }>();
        for (const article of results) {
            const root = rootOf(article);
            const name = article._crucible && article._crucible !== 'local' ? article._crucible : target.name;
            const group = byRoot.get(root) ?? { name, paths: [] };
            group.paths.push(article.path);
            byRoot.set(root, group);
        }
        for (const [root, group] of byRoot) {
            void showGraph(root, group.name, query, group.paths);
        }
    };
    await pickSearchResult(results.map(a => articlePick(a, rootOf(a))), `${results.length} results for "${query}"`, graph);
}

// =============================================================================
// The graph around the open article
// =============================================================================

/** The active crucible article as [crucible root, path relative to it]. */
function activeArticle(): [string, string] | undefined {
    const file = vscode.window.activeTextEditor?.document.uri.fsPath;
    const root = activeCrucibleRoot();
    if (!file || !root || !file.startsWith(cruciblePaths(root).wiki + path.sep)) {
        vscode.window.showInformationMessage('Open an article in a crucible wiki first.');
        return undefined;
    }
    return [root, path.relative(root, file)];
}

async function showBacklinks(): Promise<void> {
    const article = activeArticle();
    if (!article) {
        return;
    }
    const [root, rel] = article;
    try {
        const results = await cli<CrucibleArticle[]>(['backlinks', rel], root);
        if (results.length === 0) {
            vscode.window.showInformationMessage('No articles link to this one.');
            return;
        }
        await openArticleFrom(results.map(a => articlePick(a, root, a.context?.trim())),
            `${results.length} articles link here`);
    } catch (error) {
        await showCliError(error);
    }
}

async function showRelated(): Promise<void> {
    const article = activeArticle();
    if (!article) {
        return;
    }
    const [root, rel] = article;
    try {
        const results = await cli<CrucibleArticle[]>(['related', rel], root);
        if (results.length === 0) {
            vscode.window.showInformationMessage('No related articles.');
            return;
        }
        await openArticleFrom(results.map(a => articlePick(a, root, a.reasons?.join(', '))),
            `${results.length} related articles`);
    } catch (error) {
        await showCliError(error);
    }
}

async function showHistory(): Promise<void> {
    const article = activeArticle();
    if (!article) {
        return;
    }
    const [root, rel] = article;
    try {
        const history = await cli<CrucibleHistory>(['history', rel], root);
        if (history.derived_from.length === 0 && history.derivatives.length === 0) {
            vscode.window.showInformationMessage('This article has no derivation history.');
            return;
        }
        const items: ArticlePick[] = [];
        const section = (label: string, articles: CrucibleArticle[]) => {
            if (articles.length > 0) {
                items.push({ label, kind: vscode.QuickPickItemKind.Separator });
                items.push(...articles.map(a => articlePick(a, root)));
            }
        };
        section('Derived from', history.derived_from);
        section('Derived from this article', history.derivatives);
        await openArticleFrom(items, 'Derivation history');
    } catch (error) {
        await showCliError(error);
    }
}

// =============================================================================
// Ingest and distill
// =============================================================================

/** Extensions crucible treats as external sources, which may have a DOI. */
const EXTERNAL_EXTENSIONS = new Set(['.pdf', '.md', '.html', '.htm']);

interface SourceToDistill {
    path: string;
    title: string;
    citeKey?: string;
}

/**
 * Ask for an optional focus, then open Claude Code with a prompt to distill
 * `source` of the crucible at `root`.
 */
async function distillWithClaudeCode(root: string, source: SourceToDistill): Promise<void> {
    if (!(await ensureClaudeCode('Distilling a crucible source'))) {
        return;
    }
    const focus = await vscode.window.showInputBox({
        prompt: `Distill "${source.title}" with Claude Code`,
        placeHolder: 'Optional focus, e.g. "the kinetics results" (Enter for the whole source)',
    });
    if (focus === undefined) {
        return;
    }
    await openClaudeCodeWithPrompt(distillPrompt(root, source, focus));
}

/** `crucible ingest` the given file (or the active editor's), into its crucible or one the user picks. */
async function ingest(uri: vscode.Uri | undefined, onIngested: (root: string) => void): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== 'file') {
        vscode.window.showInformationMessage('Open or select a file to ingest.');
        return;
    }
    const file = target.fsPath;
    // crucible ingests the file on disk.
    const document = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file);
    if (document?.isDirty && !(await document.save())) {
        return;
    }
    const ownRoot = findCrucibleRoot(file);
    if (ownRoot && file.startsWith(path.join(ownRoot, CRUCIBLE_DIR) + path.sep)) {
        vscode.window.showInformationMessage('This file is part of a crucible already; ingest files from outside .crucible/.');
        return;
    }
    const crucible = ownRoot
        ? { name: path.basename(ownRoot), root: ownRoot }
        : await chooseCrucible(`Ingest ${path.basename(file)} into which crucible?`);
    if (!crucible) {
        return;
    }
    const args = ['ingest', file];
    if (EXTERNAL_EXTENSIONS.has(path.extname(file).toLowerCase())) {
        const doi = await vscode.window.showInputBox({
            prompt: `DOI of ${path.basename(file)} (optional)`,
            placeHolder: 'Leave empty to find one in the text or make a minimal BibTeX entry',
        });
        if (doi === undefined) {
            return;
        }
        if (doi.trim()) {
            args.push('--doi', doi.trim());
        }
    }
    let output: string;
    try {
        output = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Ingesting ${path.basename(file)} into ${crucible.name}` },
            () => runCrucible(args, { command: config().command, cwd: crucible.root, timeoutMs: 300_000 }));
    } catch (error) {
        await showCliError(error);
        return;
    }
    const result = parseIngestOutput(output);
    onIngested(crucible.root);
    const title = result.title ?? path.basename(file);
    const key = result.citeKey ? ` as ${result.citeKey}` : '';
    const message = result.alreadyIngested
        ? `${title} was already ingested in ${crucible.name}${key}.`
        : `Ingested ${title} into ${crucible.name}${key}.`;
    const actions = [
        ...(result.stored ? ['Distill with Claude Code'] : []),
        ...(result.citeKey ? ['Copy Cite Key'] : []),
    ];
    const choice = await vscode.window.showInformationMessage(message, ...actions);
    if (choice === 'Copy Cite Key' && result.citeKey) {
        await vscode.env.clipboard.writeText(result.citeKey);
    } else if (choice === 'Distill with Claude Code' && result.stored) {
        await distillWithClaudeCode(crucible.root, { path: result.stored, title, citeKey: result.citeKey });
    }
}

/** Ask a question about a crucible and hand it to Claude Code to answer from the wiki. */
async function ask(crucible: Crucible | undefined): Promise<void> {
    const target = crucible ?? await chooseCrucible('Ask which crucible?');
    if (!target || !(await ensureClaudeCode('Asking a crucible'))) {
        return;
    }
    const question = await vscode.window.showInputBox({
        prompt: `Ask ${target.name} with Claude Code`,
        placeHolder: 'A question for the knowledge base',
    });
    if (question?.trim()) {
        await openClaudeCodeWithPrompt(askPrompt(target.root, question));
    }
}

/** Pick an undigested source of a crucible and hand it to Claude Code to distill. */
async function distill(crucible: Crucible | undefined): Promise<void> {
    const target = crucible ?? await chooseCrucible('Distill a source of which crucible?');
    if (!target) {
        return;
    }
    let sources: CrucibleSource[];
    try {
        sources = await cli<CrucibleSource[]>(['undigested'], target.root);
    } catch (error) {
        await showCliError(error);
        return;
    }
    if (sources.length === 0) {
        vscode.window.showInformationMessage(`Every source in ${target.name} has been distilled.`);
        return;
    }
    const pick = await vscode.window.showQuickPick(
        sources.map(source => ({
            label: source.title,
            description: [sourceCiteKey(source), source.source_type].filter(Boolean).join(' · '),
            detail: source.path,
            source,
        })),
        { placeHolder: `${sources.length} undigested sources in ${target.name}`, matchOnDescription: true, matchOnDetail: true });
    if (pick) {
        await distillWithClaudeCode(target.root, {
            path: pick.source.path, title: pick.source.title, citeKey: sourceCiteKey(pick.source),
        });
    }
}

// =============================================================================
// Lint issues in the Problems panel
// =============================================================================

const SEVERITY: Record<CrucibleLintIssue['severity'], vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    info: vscode.DiagnosticSeverity.Information,
};

class CrucibleLint {
    private collection = vscode.languages.createDiagnosticCollection('crucible');
    /** Files given diagnostics, by crucible root, so a re-lint can clear them. */
    private files = new Map<string, vscode.Uri[]>();

    /** Run `crucible lint` and show its issues; crucible-wide ones go on index.org. */
    async lint(root: string): Promise<void> {
        const issues = await cli<CrucibleLintIssue[]>(['lint'], root);
        this.clear(root);
        if (!config().showLint) {
            return;
        }
        const byFile = new Map<string, CrucibleLintIssue[]>();
        for (const issue of issues) {
            const file = issue.path ? path.join(root, issue.path) : cruciblePaths(root).index;
            byFile.set(file, [...(byFile.get(file) ?? []), issue]);
        }
        const uris: vscode.Uri[] = [];
        for (const [file, fileIssues] of byFile) {
            let text = '';
            try {
                text = fs.readFileSync(file, 'utf8');
            } catch {
                // A missing file (e.g. a deleted article) still gets its issue on line 1.
            }
            const uri = vscode.Uri.file(file);
            this.collection.set(uri, fileIssues.map(issue => {
                const [line, start, end] = lintIssueRange(issue, text);
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(line, start, line, end), issue.message, SEVERITY[issue.severity]);
                diagnostic.source = 'crucible';
                diagnostic.code = issue.type;
                return diagnostic;
            }));
            uris.push(uri);
        }
        this.files.set(root, uris);
    }

    clear(root: string): void {
        for (const uri of this.files.get(root) ?? []) {
            this.collection.delete(uri);
        }
        this.files.delete(root);
    }

    dispose(): void {
        this.collection.dispose();
    }
}

// =============================================================================
// Tree view
// =============================================================================

class CrucibleTreeProvider implements vscode.TreeDataProvider<CrucibleNode> {
    private changed = new vscode.EventEmitter<CrucibleNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;

    refresh(): void {
        this.changed.fire(undefined);
    }

    getTreeItem(node: CrucibleNode): vscode.TreeItem {
        const collapsed = vscode.TreeItemCollapsibleState.Collapsed;
        switch (node.kind) {
            case 'crucible': {
                const item = new vscode.TreeItem(node.crucible.name,
                    node.crucible.inWorkspace ? vscode.TreeItemCollapsibleState.Expanded : collapsed);
                item.description = node.crucible.inWorkspace ? 'workspace' : undefined;
                item.tooltip = node.crucible.root;
                item.iconPath = new vscode.ThemeIcon('library');
                item.contextValue = 'crucible';
                return item;
            }
            case 'concepts': {
                const item = new vscode.TreeItem('Concepts', collapsed);
                item.iconPath = new vscode.ThemeIcon('symbol-namespace');
                return item;
            }
            case 'concept': {
                const item = new vscode.TreeItem(node.concept.name, collapsed);
                item.description = String(node.concept.article_count);
                item.iconPath = new vscode.ThemeIcon('tag');
                return item;
            }
            case 'type': {
                const item = new vscode.TreeItem(node.label, collapsed);
                item.iconPath = new vscode.ThemeIcon('folder');
                return item;
            }
            case 'article': {
                const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
                const uri = vscode.Uri.file(node.file);
                item.resourceUri = uri;
                item.description = node.description;
                item.tooltip = node.tooltip ?? node.file;
                item.iconPath = new vscode.ThemeIcon('file-text');
                item.contextValue = 'crucibleArticle';
                item.command = { command: 'vscode.open', title: 'Open Article', arguments: [uri] };
                return item;
            }
            case 'message': {
                const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon('info');
                return item;
            }
        }
    }

    async getChildren(node?: CrucibleNode): Promise<CrucibleNode[]> {
        try {
            return await this.children(node);
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            return [{ kind: 'message', text }];
        }
    }

    private async children(node?: CrucibleNode): Promise<CrucibleNode[]> {
        if (!node) {
            const crucibles = await listCrucibles();
            return crucibles.length > 0
                ? crucibles.map(crucible => ({ kind: 'crucible', crucible }))
                : [{ kind: 'message', text: 'No crucibles found (crucible init makes one)' }];
        }
        switch (node.kind) {
            case 'crucible':
                return [
                    { kind: 'concepts', crucible: node.crucible },
                    ...ARTICLE_TYPES
                        .filter(t => listWikiArticles(node.crucible.root, t.dir).length > 0)
                        .map(t => ({ kind: 'type' as const, crucible: node.crucible, dir: t.dir, label: t.label })),
                ];
            case 'concepts': {
                const concepts = await cli<CrucibleConcept[]>(['concepts'], node.crucible.root);
                return concepts.length > 0
                    ? concepts.map(concept => ({ kind: 'concept', crucible: node.crucible, concept }))
                    : [{ kind: 'message', text: 'No concepts yet' }];
            }
            case 'concept': {
                const articles = await cli<CrucibleArticle[]>(['concept', node.concept.name], node.crucible.root);
                return articles.map(a => ({
                    kind: 'article', file: path.join(node.crucible.root, a.path), title: a.title,
                    description: a.article_type, tooltip: a.abstract,
                }));
            }
            case 'type':
                return listWikiArticles(node.crucible.root, node.dir)
                    .map(a => ({ kind: 'article', file: a.file, title: a.title }));
            default:
                return [];
        }
    }
}

// =============================================================================
// Registration
// =============================================================================

export function registerCrucible(context: vscode.ExtensionContext, referenceManager?: ReferenceManager): void {
    const tree = new CrucibleTreeProvider();
    const lint = new CrucibleLint();
    const graphView = new CrucibleGraphView(
        context.extensionUri,
        root => cli<CrucibleGraph>(['graph', '--sources'], root),
        async (root, query, tags, types) => {
            const args = ['search', query, '--mode', config().searchMode, '--raw', '--limit', '1000',
                ...tags.flatMap(tag => ['--tag', tag]), ...types.flatMap(type => ['--type', type])];
            const results = await cli<CrucibleArticle[]>(args, root);
            return results.map(article => article.path);
        },
        async error => {
            if (error instanceof CrucibleCliError && /no such option/i.test(error.message)) {
                vscode.window.showErrorMessage('The Crucible graph needs a newer crucible (with crucible graph --json). Update crucible.');
                return;
            }
            await showCliError(error);
        });
    const loadedBibliographies = new Set<string>();
    const opened = new Set<string>();

    /** Load the crucible's references.bib so citations in its articles resolve. */
    const loadBibliography = async (root: string, reload = false) => {
        const bib = cruciblePaths(root).bibliography;
        if (!referenceManager || (!reload && loadedBibliographies.has(bib)) || !fs.existsSync(bib)) {
            return;
        }
        loadedBibliographies.add(bib);
        await referenceManager.addBibliographyFile(bib);
    };

    /** Lint a crucible in the background; failures are logged, not shown. */
    const lintQuietly = (root: string) => {
        lint.lint(root).catch(error => log.warn(`crucible lint failed in ${root}`, { error: String(error) }));
    };

    const onEditor = (editor: vscode.TextEditor | undefined) => {
        const uri = editor?.document.uri;
        const root = uri?.scheme === 'file' ? findCrucibleRoot(uri.fsPath) : undefined;
        void vscode.commands.executeCommand('setContext', 'scimax.inCrucible', !!root);
        if (root) {
            void loadBibliography(root);
            if (!opened.has(root)) {
                opened.add(root);
                lintQuietly(root);
            }
        }
    };
    onEditor(vscode.window.activeTextEditor);

    // ---- Sync ----------------------------------------------------------------

    const syncing = new Set<string>();
    const syncAgain = new Set<string>();
    let reportedMissingCli = false;

    /**
     * Run `crucible sync`, then refresh the panel, bibliography and lint
     * issues. A sync asked for while one runs in the same crucible runs after it.
     */
    const syncCrucible = async (root: string, name: string, quiet: boolean): Promise<void> => {
        if (syncing.has(root)) {
            syncAgain.add(root);
            return;
        }
        syncing.add(root);
        try {
            const run = () => runCrucible(['sync'], { command: config().command, cwd: root });
            const output = quiet
                ? await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Window, title: `Syncing ${name}` }, run)
                : await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Syncing ${name}` }, run);
            vscode.window.setStatusBarMessage(output.split('\n').pop() || `Synced ${name}`, 5000);
            tree.refresh();
            void graphView.refresh(root);
            await loadBibliography(root, true);
            lintQuietly(root);
        } catch (error) {
            const missingCli = error instanceof CrucibleCliError && error.notFound;
            if (!quiet || (missingCli && !reportedMissingCli)) {
                reportedMissingCli ||= missingCli;
                await showCliError(error);
            } else {
                log.warn(`crucible sync failed in ${root}`, { error: String(error) });
                vscode.window.setStatusBarMessage(`$(warning) crucible sync failed in ${name}`, 5000);
            }
        } finally {
            syncing.delete(root);
            if (syncAgain.delete(root)) {
                void syncCrucible(root, name, quiet);
            }
        }
    };

    // Saving a wiki article syncs its crucible, once saves pause.
    const saveTimers = new Map<string, NodeJS.Timeout>();
    const onSave = (document: vscode.TextDocument) => {
        if (!config().syncOnSave || document.uri.scheme !== 'file' || !document.fileName.endsWith('.org')) {
            return;
        }
        const root = findCrucibleRoot(document.fileName);
        if (!root || !document.fileName.startsWith(cruciblePaths(root).wiki + path.sep)) {
            return;
        }
        clearTimeout(saveTimers.get(root));
        saveTimers.set(root, setTimeout(() => {
            saveTimers.delete(root);
            void syncCrucible(root, path.basename(root), true);
        }, 1500));
    };

    const showResultsGraph: ShowResultsGraph = (root, name, query, paths) =>
        graphView.show(root, name, undefined, { query, paths });

    const nodeCrucible = (node?: CrucibleNode) => node?.kind === 'crucible' ? node.crucible : undefined;

    context.subscriptions.push(
        lint,
        graphView,
        { dispose: () => saveTimers.forEach(timer => clearTimeout(timer)) },
        vscode.window.registerTreeDataProvider('scimax.crucible', tree),
        vscode.window.onDidChangeActiveTextEditor(onEditor),
        vscode.workspace.onDidSaveTextDocument(onSave),
        vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh()),
        vscode.commands.registerCommand('scimax.crucible.refresh', () => tree.refresh()),
        vscode.commands.registerCommand('scimax.crucible.search', (node?: CrucibleNode) => search(nodeCrucible(node), false, showResultsGraph)),
        vscode.commands.registerCommand('scimax.crucible.searchAll', () => search(undefined, true, showResultsGraph)),
        vscode.commands.registerCommand('scimax.crucible.searchResultsGraph', searchResultsGraph),
        vscode.commands.registerCommand('scimax.crucible.backlinks', showBacklinks),
        vscode.commands.registerCommand('scimax.crucible.related', showRelated),
        vscode.commands.registerCommand('scimax.crucible.history', showHistory),
        vscode.commands.registerCommand('scimax.crucible.ingest', (uri?: vscode.Uri) =>
            ingest(uri instanceof vscode.Uri ? uri : undefined, () => tree.refresh())),
        vscode.commands.registerCommand('scimax.crucible.graph', async (node?: CrucibleNode) => {
            const crucible = nodeCrucible(node) ?? await chooseCrucible('Show the graph of which crucible?');
            if (crucible) {
                await graphView.show(crucible.root, crucible.name, vscode.window.activeTextEditor?.document.uri.fsPath);
            }
        }),
        vscode.commands.registerCommand('scimax.crucible.ask', (node?: CrucibleNode) => ask(nodeCrucible(node))),
        vscode.commands.registerCommand('scimax.crucible.distill', (node?: CrucibleNode) => distill(nodeCrucible(node))),
        vscode.commands.registerCommand('scimax.crucible.openIndex', async (node?: CrucibleNode) => {
            const crucible = nodeCrucible(node) ?? await chooseCrucible('Open the index of which crucible?');
            if (!crucible) {
                return;
            }
            const { index, wiki } = cruciblePaths(crucible.root);
            if (!fs.existsSync(index)) {
                vscode.window.showInformationMessage(`${crucible.name} has no index yet (crucible index makes one): ${wiki}`);
                return;
            }
            await vscode.window.showTextDocument(vscode.Uri.file(index));
        }),
        vscode.commands.registerCommand('scimax.crucible.sync', async (node?: CrucibleNode) => {
            const crucible = nodeCrucible(node) ?? await chooseCrucible('Sync which crucible?');
            if (crucible) {
                await syncCrucible(crucible.root, crucible.name, false);
            }
        }),
        vscode.commands.registerCommand('scimax.crucible.lint', async (node?: CrucibleNode) => {
            const crucible = nodeCrucible(node) ?? await chooseCrucible('Lint which crucible?');
            if (!crucible) {
                return;
            }
            try {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Window, title: `Linting ${crucible.name}` },
                    () => lint.lint(crucible.root));
                await vscode.commands.executeCommand('workbench.actions.view.problems');
            } catch (error) {
                await showCliError(error);
            }
        }),
    );
}
