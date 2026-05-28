import * as vscode from 'vscode';

/**
 * Emacs-style `recenter-top-bottom` (C-l).
 *
 * Repeated invocations while the cursor stays put cycle the cursor line
 * through three scroll positions:
 *
 *   1st press -> center
 *   2nd press -> top
 *   3rd press -> bottom
 *   4th press -> center (cycle repeats)
 *
 * Moving the cursor or switching editors resets the cycle back to "center".
 */

interface RecenterState {
    uri: string;
    line: number;
    character: number;
    /** 0 = center, 1 = top, 2 = bottom */
    index: number;
}

let lastState: RecenterState | undefined;

/**
 * Estimate the viewport height in lines from the editor's visible ranges.
 * Folding can split `visibleRanges` into several pieces, so span from the
 * first range's start to the last range's end.
 */
function viewportHeight(editor: vscode.TextEditor): number {
    const ranges = editor.visibleRanges;
    if (ranges.length === 0) {
        return 0;
    }
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    return Math.max(0, last.end.line - first.start.line);
}

function recenterTopBottom(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const active = editor.selection.active;
    const uri = editor.document.uri.toString();

    // Advance the cycle only if the cursor is exactly where it was for the
    // previous invocation; otherwise start a fresh cycle at "center".
    let index = 0;
    if (
        lastState &&
        lastState.uri === uri &&
        lastState.line === active.line &&
        lastState.character === active.character
    ) {
        index = (lastState.index + 1) % 3;
    }

    const lineRange = editor.document.lineAt(active.line).range;

    switch (index) {
        case 0: // center
            editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenter);
            break;
        case 1: // top
            editor.revealRange(lineRange, vscode.TextEditorRevealType.AtTop);
            break;
        case 2: { // bottom
            // VS Code has no "AtBottom" reveal type, so reveal the line one
            // viewport-height above the cursor at the top -- that leaves the
            // cursor line resting at the bottom of the viewport.
            const topLine = Math.max(0, active.line - viewportHeight(editor));
            const target = new vscode.Range(topLine, 0, topLine, 0);
            editor.revealRange(target, vscode.TextEditorRevealType.AtTop);
            break;
        }
    }

    lastState = { uri, line: active.line, character: active.character, index };
}

/** Register the recenter-top-bottom command. */
export function registerRecenterCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.recenterTopBottom', recenterTopBottom)
    );
}
