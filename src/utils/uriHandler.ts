/**
 * The single `vscode://jkitchin.scimax-vscode/...` URI handler.
 *
 * VS Code allows one URI handler per extension, so features add routes here
 * by path (`/open` for inverse SyncTeX, `/org-link` for links from Excalidraw
 * drawings, ...) instead of registering their own handler.
 */
import * as vscode from 'vscode';
import { extensionLogger as log } from './logger';

export type UriRoute = (uri: vscode.Uri) => void | Promise<void>;

const routes = new Map<string, UriRoute>();
let registered = false;

/** Handle `vscode://jkitchin.scimax-vscode<path>?...` with `route`. */
export function registerUriRoute(path: string, route: UriRoute): vscode.Disposable {
    routes.set(path, route);
    return new vscode.Disposable(() => {
        if (routes.get(path) === route) routes.delete(path);
    });
}

/** Register the extension's URI handler (once, from activate). */
export function registerScimaxUriHandler(context: vscode.ExtensionContext): void {
    if (registered) return;
    registered = true;
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            async handleUri(uri: vscode.Uri): Promise<void> {
                const route = routes.get(uri.path);
                if (!route) {
                    log.warn(`No scimax handler for URI path ${uri.path}`);
                    vscode.window.showWarningMessage(`Scimax: no handler for ${uri.path}`);
                    return;
                }
                try {
                    await route(uri);
                } catch (error) {
                    log.error(`URI handler ${uri.path} failed`, error as Error);
                    vscode.window.showErrorMessage(`Scimax: could not open link: ${(error as Error).message}`);
                }
            },
        }),
        new vscode.Disposable(() => { registered = false; })
    );
}
