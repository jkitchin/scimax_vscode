/**
 * The scimax extension's VS Code global storage folder, which the CLI shares
 * with it (the database, and caches such as KaTeX fonts and Pyodide files).
 */

import * as path from 'path';

export function scimaxGlobalStorageDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const platform = process.platform;

    let basePath: string;
    if (platform === 'darwin') {
        basePath = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
    } else if (platform === 'win32') {
        basePath = path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage');
    } else {
        // Linux and others
        basePath = path.join(home, '.config', 'Code', 'User', 'globalStorage');
    }

    return path.join(basePath, 'jkitchin.scimax-vscode');
}
