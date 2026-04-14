/**
 * Stub for the 'vscode' module when running in CLI mode.
 *
 * Installs a require() hook that returns a minimal vscode API so modules
 * which transitively import 'vscode' (e.g., utils/pathResolver) can load
 * outside the extension host. Must be imported before any such module.
 */

import Module from 'module';

const stubExports = {
    workspace: {
        getConfiguration: (_section?: string) => ({
            get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
            update: async () => {},
            has: () => false,
            inspect: () => undefined,
        }),
        workspaceFolders: undefined as unknown,
        onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    window: {
        showErrorMessage: (msg: string) => { console.error(msg); },
        showWarningMessage: (msg: string) => { console.warn(msg); },
        showInformationMessage: (msg: string) => { console.log(msg); },
        createOutputChannel: () => ({
            appendLine: () => {},
            append: () => {},
            show: () => {},
            clear: () => {},
            dispose: () => {},
        }),
    },
    Uri: {
        file: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }),
        parse: (s: string) => ({ fsPath: s, path: s, scheme: 'file' }),
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    Disposable: class { dispose() {} static from() { return new (this as any)(); } },
};

const STUB_ID = '__vscode_stub__';

const mod = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
const origResolve = mod._resolveFilename;
mod._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === 'vscode') {
        return STUB_ID;
    }
    return origResolve.call(this, request, ...rest);
};

require.cache[STUB_ID] = {
    id: STUB_ID,
    filename: STUB_ID,
    loaded: true,
    exports: stubExports,
    children: [],
    paths: [],
} as unknown as NodeJS.Module;
