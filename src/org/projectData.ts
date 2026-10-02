/**
 * Project-wide task data for the VS Code side.
 *
 * A "project" is the folder tree under a project root (the nearest folder with
 * a .git, .projectile, ... marker). Its org files are found by walking that
 * folder rather than by asking the database, because the database only knows
 * the files under its scan roots and the files that happened to be opened:
 * a new file in a project would otherwise be missing from its own project.
 *
 * Open editors win over the disk, so unsaved edits show up immediately.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseOrg } from '../parser/orgParserUnified';
import type { OrgDocumentNode } from '../parser/orgElementTypes';
import { org } from '../parser/orgModify';
import {
    extractProjectTasks,
    isTaskBlocked,
    type ProjectTask,
} from '../parser/projectTasks';
import { findProjectRoot } from '../notebook/notebookManager';
import { walkDirectory } from '../shared/fileWalker';

/** Stop after this many org files: a project tree is not the whole disk. */
const MAX_PROJECT_FILES = 2000;

export interface ProjectDocument {
    filePath: string;
    doc: OrgDocumentNode;
}

/** A task with the project-wide facts the views need. */
export interface ProjectTaskInfo extends ProjectTask {
    file: string;
    /** An in-project dependency is not done yet. */
    blocked: boolean;
}

/**
 * Project root for a file: the nearest folder with a project marker, else its
 * workspace folder. With no file, the only workspace folder, if there is one.
 */
export function projectRootFor(uri?: vscode.Uri): string | undefined {
    if (uri?.scheme === 'file') {
        const root = findProjectRoot(path.dirname(uri.fsPath));
        if (root) return root;
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder) return folder.uri.fsPath;
    }
    const folders = vscode.workspace.workspaceFolders;
    return folders?.length === 1 ? folders[0].uri.fsPath : undefined;
}

/** Project root for the active editor's file. */
export function currentProjectRoot(): string | undefined {
    return projectRootFor(vscode.window.activeTextEditor?.document.uri);
}

/** Every .org file under root, honouring .gitignore and the default ignores. */
export async function findProjectOrgFiles(root: string): Promise<string[]> {
    const result = await walkDirectory(root, { extensions: ['.org'], maxFiles: MAX_PROJECT_FILES });
    if (result.truncated) {
        vscode.window.showWarningMessage(
            `Project ${path.basename(root)} has more than ${MAX_PROJECT_FILES} org files; only the first ${MAX_PROJECT_FILES} are used.`
        );
    }
    return result.files.sort();
}

/** Parse every org file in the project, preferring open editors' text. */
export async function loadProjectDocuments(root: string): Promise<ProjectDocument[]> {
    const open = new Map<string, string>();
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === 'file') open.set(doc.uri.fsPath, doc.getText());
    }

    const docs: ProjectDocument[] = [];
    for (const filePath of await findProjectOrgFiles(root)) {
        try {
            const content = open.get(filePath) ?? await fs.promises.readFile(filePath, 'utf-8');
            docs.push({ filePath, doc: parseOrg(content, { filePath }) });
        } catch {
            // Unreadable or unparsable: leave it out rather than fail the view.
        }
    }
    return docs;
}

/**
 * Every TODO task in the documents, with distinct gantt ids across files and
 * blocked state resolved against the whole set. With todoOnly false, headings
 * without a TODO keyword are included too (the agenda shows those).
 */
export function collectProjectTasks(docs: ProjectDocument[], todoOnly = true): ProjectTaskInfo[] {
    const ganttIds = { used: new Set<string>(), counter: 0 };
    const tasks: ProjectTask[] = [];
    for (const { filePath, doc } of docs) {
        const headlines = org.getAllHeadlines(doc);
        tasks.push(...extractProjectTasks(doc, headlines, { todoOnly, file: filePath, ganttIds }));
    }
    const byId = new Map<string, ProjectTask>();
    for (const t of tasks) if (t.id) byId.set(t.id, t);
    return tasks.map(t => ({
        ...t,
        file: t.file!,
        blocked: !t.isDone && isTaskBlocked(t, byId),
    }));
}

/** Load and collect in one step. */
export async function loadProjectTasks(root: string): Promise<ProjectTaskInfo[]> {
    return collectProjectTasks(await loadProjectDocuments(root));
}

/** Key for matching a task to an agenda item: file and 1-based line. */
export function taskKey(file: string, line: number): string {
    return `${file}:${line}`;
}
