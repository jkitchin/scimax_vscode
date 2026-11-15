/**
 * Org-style fast TODO state selection (org-use-fast-todo-selection).
 *
 * Keywords declared with a key, e.g.
 *   #+TODO: INVITED(i) AGREED(a) | REVIEWED(r) DECLINED(d)
 * can be set with a single keystroke: the picker accepts as soon as a
 * declared key is typed, and SPC removes the keyword. Typing anything else
 * filters the list as usual.
 */

import * as vscode from 'vscode';
import { getTodoWorkflowForDocument } from './todoStates';
import { hasFastTodoKeys, TodoWorkflow } from '../shared/todoKeywords';
import { changeTodoState, cycleTodoState } from './scimaxOrg';

/** Pseudo-state for "remove the keyword". */
const NONE = '';

interface StateItem extends vscode.QuickPickItem {
    state: string;
}

/**
 * Resolve a single typed character to a target state, or undefined when it
 * is not a fast key. SPC means "no keyword".
 */
export function resolveFastKey(input: string, workflow: TodoWorkflow): string | undefined {
    if (input === ' ') return NONE;
    if (input.length !== 1) return undefined;
    for (const [state, key] of Object.entries(workflow.fastKeys ?? {})) {
        if (key === input) return state;
    }
    return undefined;
}

/** The TODO keyword on a heading line, if any. */
function currentKeyword(lineText: string, workflow: TodoWorkflow): string | undefined {
    const m = lineText.match(/^(?:\*+|#{1,6})\s+\[?([^\s\]]+)\]?(?=\s|$)/);
    return m && workflow.allStates.includes(m[1]) ? m[1] : undefined;
}

function buildItems(workflow: TodoWorkflow, current: string | undefined): (StateItem | vscode.QuickPickItem)[] {
    const done = new Set(workflow.doneStates);
    const keys = workflow.fastKeys ?? {};
    const sequences = workflow.sequences?.length ? workflow.sequences : [workflow.allStates];
    const items: (StateItem | vscode.QuickPickItem)[] = [];
    const seen = new Set<string>();

    sequences.forEach((seq, i) => {
        if (sequences.length > 1) {
            items.push({ label: seq.join(' '), kind: vscode.QuickPickItemKind.Separator });
        }
        for (const state of seq) {
            if (seen.has(state)) continue;
            seen.add(state);
            const key = keys[state];
            items.push({
                label: key ? `[${key}] ${state}` : state,
                description: [done.has(state) ? 'done' : '', state === current ? 'current' : '']
                    .filter(Boolean).join(' · ') || undefined,
                state,
            } as StateItem);
        }
        if (i === sequences.length - 1) {
            items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        }
    });
    items.push({ label: '[SPC] (none)', description: 'remove keyword', state: NONE } as StateItem);
    return items;
}

/**
 * Show the fast-selection picker for the heading at point and apply the
 * chosen state. A string argument sets that state directly (for keybindings).
 */
export async function setTodoState(target?: unknown): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (typeof target === 'string') {
        await changeTodoState(target);
        return;
    }

    const document = editor.document;
    const workflow = getTodoWorkflowForDocument(document);
    const lineText = document.lineAt(editor.selection.active.line).text;
    if (!/^(?:\*+|#{1,6})\s/.test(lineText)) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }
    const current = currentKeyword(lineText, workflow);

    const picked = await new Promise<string | undefined>(resolve => {
        const qp = vscode.window.createQuickPick<StateItem | vscode.QuickPickItem>();
        qp.title = hasFastTodoKeys(workflow)
            ? 'TODO state: press a key (SPC = none)'
            : 'TODO state';
        qp.placeholder = current ? `Current: ${current}` : 'No keyword';
        qp.items = buildItems(workflow, current);
        let result: string | undefined;
        qp.onDidChangeValue(value => {
            const state = resolveFastKey(value, workflow);
            if (state !== undefined) {
                result = state;
                qp.hide();
            }
        });
        qp.onDidAccept(() => {
            const sel = qp.selectedItems[0] as StateItem | undefined;
            if (sel && 'state' in sel) result = sel.state;
            qp.hide();
        });
        qp.onDidHide(() => {
            qp.dispose();
            resolve(result);
        });
        qp.show();
    });

    if (picked === undefined) return;
    // The picker steals focus; make sure we edit the editor we started from.
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    await changeTodoState(picked);
}

/**
 * org-todo DWIM: with fast keys declared in the file, open fast selection;
 * otherwise cycle to the next state.
 */
export async function todoDwim(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (hasFastTodoKeys(getTodoWorkflowForDocument(editor.document))) {
        await setTodoState();
    } else {
        await cycleTodoState();
    }
}

export function registerTodoFastSelect(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.setTodoState', setTodoState),
        vscode.commands.registerCommand('scimax.org.todo', todoDwim),
    );
}
