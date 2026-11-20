import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const saveHandlers: Array<(doc: { uri: { fsPath: string } }) => void> = [];

vi.mock('vscode', () => {
    class EventEmitter<T> {
        private listeners: Array<(e: T) => void> = [];
        event = (listener: (e: T) => void) => {
            this.listeners.push(listener);
            return { dispose: () => undefined };
        };
        fire(e: T) { this.listeners.forEach(l => l(e)); }
        dispose() { this.listeners = []; }
    }
    return {
        EventEmitter,
        workspace: {
            workspaceFolders: undefined,
            onDidSaveTextDocument: (h: (doc: { uri: { fsPath: string } }) => void) => {
                saveHandlers.push(h);
                return { dispose: () => undefined };
            },
            openTextDocument: vi.fn()
        },
        window: {
            showTextDocument: vi.fn(),
            showInformationMessage: vi.fn(),
            showWarningMessage: vi.fn(),
            showErrorMessage: vi.fn()
        }
    };
});

import { NotebookManager } from '../notebookManager';

function makeManager(storage: string): NotebookManager {
    const context = { globalStorageUri: { fsPath: storage } } as unknown as import('vscode').ExtensionContext;
    return new NotebookManager(context);
}

function writeConfig(root: string, config: object): void {
    fs.mkdirSync(path.join(root, '.scimax'), { recursive: true });
    fs.writeFileSync(path.join(root, '.scimax', 'config.json'), JSON.stringify(config));
}

describe('NotebookManager', () => {
    let tmp: string;
    let project: string;
    let manager: NotebookManager;

    beforeEach(async () => {
        saveHandlers.length = 0;
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-nb-'));
        project = path.join(tmp, 'proj');
        fs.mkdirSync(project);
        fs.writeFileSync(path.join(project, '.projectile'), '');
        manager = makeManager(path.join(tmp, 'storage'));
        await manager.initialize();
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('fires onDidChangeNotebooks when a notebook is registered', () => {
        const listener = vi.fn();
        manager.onDidChangeNotebooks(listener);
        manager.registerNotebook(project);
        expect(listener).toHaveBeenCalled();
    });

    it('reloadConfigs picks up name, commands and master file edited on disk', () => {
        const nb = manager.registerNotebook(project);
        expect(nb.name).toBe('proj');

        fs.writeFileSync(path.join(project, 'main.org'), '* hi\n');
        writeConfig(project, {
            name: 'Renamed',
            description: 'desc',
            masterFile: 'main.org',
            customCommands: { test: 'echo ok' }
        });

        const listener = vi.fn();
        manager.onDidChangeNotebooks(listener);
        manager.reloadConfigs(project);

        expect(nb.name).toBe('Renamed');
        expect(nb.description).toBe('desc');
        expect(nb.masterFile).toBe(path.join(project, 'main.org'));
        expect(nb.config?.customCommands).toEqual({ test: 'echo ok' });
        expect(listener).toHaveBeenCalled();
    });

    it('reloads a notebook when its .scimax/config.json is saved', () => {
        const nb = manager.registerNotebook(project);
        writeConfig(project, { name: 'Saved Name' });

        const configPath = path.join(project, '.scimax', 'config.json');
        saveHandlers.forEach(h => h({ uri: { fsPath: configPath } }));

        expect(nb.name).toBe('Saved Name');
    });

    it('ignores saves of unrelated config.json files', () => {
        const nb = manager.registerNotebook(project);
        writeConfig(project, { name: 'Should Not Load' });

        saveHandlers.forEach(h => h({ uri: { fsPath: path.join(project, 'config.json') } }));

        expect(nb.name).toBe('proj');
    });

    it('addCollaborator persists and notifies listeners', async () => {
        const nb = manager.registerNotebook(project);
        const listener = vi.fn();
        manager.onDidChangeNotebooks(listener);

        await manager.addCollaborator(nb, { name: 'A. Person', email: 'a@example.com', role: 'PI' });

        const saved = JSON.parse(fs.readFileSync(path.join(project, '.scimax', 'config.json'), 'utf8'));
        expect(saved.collaborators).toHaveLength(1);
        expect(listener).toHaveBeenCalled();
    });

    it('removeNotebook drops it from the list and notifies listeners', () => {
        const nb = manager.registerNotebook(project);
        const listener = vi.fn();
        manager.onDidChangeNotebooks(listener);

        manager.removeNotebook(nb);

        expect(manager.getNotebooks().find(n => n.path === project)).toBeUndefined();
        expect(listener).toHaveBeenCalled();
    });
});
