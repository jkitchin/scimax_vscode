/**
 * macOS-specific link insertion: pull the current Finder selection or
 * the front Chrome tab's URL via AppleScript and insert as org links.
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Note: inside `tell application "Finder"` / `tell application "Google Chrome"`,
// the keywords `tab` and `linefeed` can collide with app-defined classes. Build
// strings inside the tell block but assemble the delimited return value outside,
// using `ASCII character` to be unambiguous.

const TAB = '(ASCII character 9)';
const LF = '(ASCII character 10)';

const FINDER_APPLESCRIPT = `
set theNames to {}
set thePaths to {}
tell application "Finder"
  set sel to selection as alias list
  if (count of sel) is 0 then
    try
      set winFolder to (folder of front window) as alias
      set sel to {winFolder}
    on error
      return ""
    end try
  end if
  repeat with i in sel
    set end of theNames to (name of (item i))
    set end of thePaths to (POSIX path of i)
  end repeat
end tell
set out to ""
set n to count of theNames
repeat with idx from 1 to n
  if out is not "" then set out to out & ${LF}
  set out to out & (item idx of theNames) & ${TAB} & (item idx of thePaths)
end repeat
return out
`.trim();

const CHROME_APPLESCRIPT = `
set theTitle to ""
set theURL to ""
tell application "Google Chrome"
  if (count of windows) is 0 then return ""
  set t to active tab of front window
  set theURL to URL of t
  set theTitle to title of t
end tell
return theTitle & ${TAB} & theURL
`.trim();

async function runOsascript(script: string): Promise<string> {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: 10_000
    });
    return stdout.replace(/\n$/, '');
}

function requireDarwin(): boolean {
    if (process.platform !== 'darwin') {
        vscode.window.showWarningMessage('This command is only available on macOS.');
        return false;
    }
    return true;
}

function escapeDescription(s: string): string {
    return s.replace(/[[\]]/g, '');
}

/**
 * Insert org file: links for items currently selected in Finder.
 * Falls back to the front Finder window's folder if nothing is selected.
 */
export async function insertFinderLink(): Promise<void> {
    if (!requireDarwin()) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let output: string;
    try {
        output = await runOsascript(FINDER_APPLESCRIPT);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Could not query Finder: ${msg}`);
        return;
    }

    if (!output) {
        vscode.window.showInformationMessage('No Finder selection or front window.');
        return;
    }

    const links = output.split('\n').map(line => {
        const [name, ...rest] = line.split('\t');
        const filePath = rest.join('\t');
        if (!filePath) return '';
        return `[[file:${filePath}][${escapeDescription(name)}]]`;
    }).filter(s => s.length > 0);

    if (links.length === 0) return;

    const text = links.join('\n');
    await editor.edit(eb => eb.insert(editor.selection.active, text));
}

/**
 * Insert an org link to the URL of the front tab in Google Chrome,
 * using the tab title as the description.
 */
export async function insertChromeLink(): Promise<void> {
    if (!requireDarwin()) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let output: string;
    try {
        output = await runOsascript(CHROME_APPLESCRIPT);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Could not query Chrome: ${msg}`);
        return;
    }

    if (!output) {
        vscode.window.showInformationMessage('No Chrome window open.');
        return;
    }

    const tabIdx = output.indexOf('\t');
    const title = tabIdx >= 0 ? output.slice(0, tabIdx) : '';
    const url = tabIdx >= 0 ? output.slice(tabIdx + 1) : output;
    if (!url) return;

    const link = title
        ? `[[${url}][${escapeDescription(title)}]]`
        : `[[${url}]]`;

    await editor.edit(eb => eb.insert(editor.selection.active, link));
}

export function registerMacLinkCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.insertFinderLink', insertFinderLink),
        vscode.commands.registerCommand('scimax.org.insertChromeLink', insertChromeLink)
    );
}
