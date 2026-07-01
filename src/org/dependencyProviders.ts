/**
 * Surfacing for TODO task dependencies:
 *
 *   - DependencyCodeLensProvider: a 🔒/▶ lens on each active TODO heading that has
 *     dependencies (or sits under an ORDERED parent), showing whether it is
 *     blocked or ready. Clicking a blocked lens jumps to the blocker.
 *   - DependencyTreeProvider: a side-panel tree for the heading at the cursor,
 *     with "Depends on →" and "Blocks →" branches, each entry badged with the
 *     target's TODO state and navigable.
 *
 * Both read from the database index, which refreshes on save, so results reflect
 * the last saved state.
 */
import * as vscode from 'vscode';
import { getDatabase } from '../database/lazyDb';
import { getTodoWorkflowForDocument } from './todoStates';
import {
    findEnclosingHeadingLine,
    readHeadingProperty,
    getDependsAt,
    getUnsatisfiedBlockers,
    getOrderedBlocker,
    resolveBlockers,
    isDoneStateName,
    Blocker,
} from './dependencies';

function isOrg(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'org' || doc.fileName.endsWith('.org');
}

function indicatorsEnabled(): boolean {
    const c = vscode.workspace.getConfiguration('scimax.org.depend');
    return c.get<boolean>('enabled', true) && c.get<boolean>('showIndicators', true);
}

// ---------------------------------------------------------------------------
// CodeLens: blocked / ready indicator
// ---------------------------------------------------------------------------

class DependencyCodeLensProvider implements vscode.CodeLensProvider {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;
    private readonly cache = new Map<string, { version: number; lenses: vscode.CodeLens[] }>();

    refresh(): void {
        this.cache.clear();
        this._onDidChange.fire();
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        if (!isOrg(document) || !indicatorsEnabled()) return [];

        const key = document.uri.toString();
        const cached = this.cache.get(key);
        if (cached && cached.version === document.version) return cached.lenses;

        const workflow = getTodoWorkflowForDocument(document);
        const activeStates = new Set(workflow.activeStates);
        const doneStates = new Set(workflow.doneStates);
        const stateRe = /^\*+\s+(\S+)/;

        const lenses: vscode.CodeLens[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            const text = document.lineAt(i).text;
            const m = text.match(stateRe);
            if (!m || !activeStates.has(m[1])) continue;

            const dependsIds = getDependsAt(document, i);
            const orderedBlocker = getOrderedBlocker(document, i, doneStates);
            if (dependsIds.length === 0 && !orderedBlocker) continue;

            const range = new vscode.Range(i, 0, i, 0);
            const unmet = dependsIds.length > 0
                ? await getUnsatisfiedBlockers(dependsIds, doneStates)
                : [];
            const blockedCount = unmet.length + (orderedBlocker ? 1 : 0);

            if (blockedCount > 0) {
                lenses.push(new vscode.CodeLens(range, {
                    title: `$(lock) blocked by ${blockedCount}`,
                    command: 'scimax.org.gotoBlocker',
                    arguments: [],
                }));
            } else {
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(check) ready',
                    command: '',
                    arguments: [],
                }));
            }
        }

        this.cache.set(key, { version: document.version, lenses });
        return lenses;
    }
}

// ---------------------------------------------------------------------------
// Tree view: depends-on / blocks for the heading at the cursor
// ---------------------------------------------------------------------------

type Node =
    | { kind: 'group'; label: string; children: Node[] }
    | { kind: 'edge'; blocker: Blocker }
    | { kind: 'info'; label: string };

class DependencyTreeProvider implements vscode.TreeDataProvider<Node> {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChange.event;
    private roots: Node[] = [];
    private visible = false;

    /** Track panel visibility so we never do DB work while it's hidden. */
    setVisible(v: boolean): void {
        this.visible = v;
        if (v) this.refresh();
    }

    refresh(): void {
        // The tree queries the DB on rebuild; skip entirely when not shown so
        // cursor movement / edits don't pay for a panel nobody is looking at.
        if (!this.visible) return;
        void this.rebuild().then(() => this._onDidChange.fire());
    }

    private async rebuild(): Promise<void> {
        this.roots = [];
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isOrg(editor.document)) {
            this.roots = [{ kind: 'info', label: 'Open an org heading to see its dependencies' }];
            return;
        }
        const document = editor.document;
        const line = editor.selection.active.line;
        const headingLine = findEnclosingHeadingLine(document, line);
        if (headingLine < 0) {
            this.roots = [{ kind: 'info', label: 'Cursor is not under a heading' }];
            return;
        }

        const workflow = getTodoWorkflowForDocument(document);
        const doneStates = new Set(workflow.doneStates);

        // Depends on → (read directly from the heading's :DEPENDS:).
        const dependsIds = getDependsAt(document, headingLine);
        const dependsOn = await resolveBlockers(dependsIds, doneStates);
        const dependsChildren: Node[] = dependsOn.length > 0
            ? dependsOn.map(b => ({ kind: 'edge', blocker: b } as Node))
            : [{ kind: 'info', label: '(none)' }];

        // Blocks → (reverse edges from the DB, needs this heading's :ID:).
        const id = readHeadingProperty(document, headingLine, 'ID')?.replace(/^id:/i, '');
        const blocksChildren: Node[] = [];
        const db = await getDatabase();
        if (id && db) {
            const dependents = await db.getDependents(id);
            const seen = new Set<string>();
            for (const edge of dependents) {
                if (!edge.from_id || seen.has(edge.from_id)) continue;
                seen.add(edge.from_id);
                const heading = await db.getHeadingById(edge.from_id);
                blocksChildren.push({
                    kind: 'edge',
                    blocker: heading
                        ? {
                            id: edge.from_id,
                            found: true,
                            title: heading.title,
                            todoState: heading.todo_state,
                            filePath: heading.file_path,
                            lineNumber: heading.line_number,
                            satisfied: isDoneStateName(heading.todo_state, doneStates),
                        }
                        : { id: edge.from_id, found: false, satisfied: false },
                });
            }
        }
        if (blocksChildren.length === 0) {
            blocksChildren.push({ kind: 'info', label: id ? '(none)' : 'add an :ID: to see what blocks on this' });
        }

        this.roots = [
            { kind: 'group', label: 'Depends on →', children: dependsChildren },
            { kind: 'group', label: 'Blocks →', children: blocksChildren },
        ];
    }

    getChildren(element?: Node): Node[] {
        if (!element) return this.roots;
        return element.kind === 'group' ? element.children : [];
    }

    getTreeItem(node: Node): vscode.TreeItem {
        if (node.kind === 'group') {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = 'dependencyGroup';
            return item;
        }
        if (node.kind === 'info') {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
            item.description = '';
            return item;
        }
        const b = node.blocker;
        const item = new vscode.TreeItem(
            b.found ? (b.title ?? b.id) : `missing: ${b.id}`,
            vscode.TreeItemCollapsibleState.None
        );
        if (b.found) {
            item.description = b.todoState ?? '';
            item.iconPath = new vscode.ThemeIcon(b.satisfied ? 'check' : 'circle-outline');
            if (b.filePath && b.lineNumber) {
                item.command = {
                    command: 'vscode.open',
                    title: 'Open',
                    arguments: [
                        vscode.Uri.file(b.filePath),
                        { selection: new vscode.Range(b.lineNumber - 1, 0, b.lineNumber - 1, 0) },
                    ],
                };
            }
        } else {
            item.iconPath = new vscode.ThemeIcon('warning');
        }
        return item;
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDependencyProviders(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = [{ language: 'org' }, { pattern: '**/*.org' }];

    const codeLens = new DependencyCodeLensProvider();
    const tree = new DependencyTreeProvider();
    const treeView = vscode.window.createTreeView('scimaxDependencies', { treeDataProvider: tree });
    tree.setVisible(treeView.visible);

    // Debounce cursor-driven tree refreshes; it's a no-op when the panel is
    // hidden, and coalesced to one query when it is shown.
    let selTimer: NodeJS.Timeout | undefined;

    context.subscriptions.push(
        treeView,
        vscode.languages.registerCodeLensProvider(selector, codeLens),
        treeView.onDidChangeVisibility(e => tree.setVisible(e.visible)),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (isOrg(doc)) { codeLens.refresh(); tree.refresh(); }
        }),
        vscode.window.onDidChangeActiveTextEditor(() => { codeLens.refresh(); tree.refresh(); }),
        vscode.window.onDidChangeTextEditorSelection(e => {
            if (!isOrg(e.textEditor.document)) return;
            if (selTimer) clearTimeout(selTimer);
            selTimer = setTimeout(() => tree.refresh(), 300);
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scimax.org.depend')) codeLens.refresh();
        })
    );
}
