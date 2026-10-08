/**
 * Ctrl+click on a ~ file link resolves under the home directory, not the
 * linking document's directory.
 */
import { describe, it, expect, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => {
    class Range { constructor(public start: unknown, public end: unknown) {} }
    class DocumentLink {
        target?: { toString(): string };
        tooltip?: string;
        constructor(public range: Range) {}
    }
    return {
        Range,
        DocumentLink,
        Uri: { parse: (value: string) => ({ value, toString: () => value }) },
        workspace: {},
        window: {},
        commands: {},
    };
});
vi.mock('../../database/lazyDb', () => ({ getDatabase: vi.fn() }));

import { OrgLinkProvider } from '../orgLinkProvider';

function linkTargetFile(text: string): string {
    const document = {
        uri: { fsPath: path.join(path.sep, 'docs', 'notes.org') },
        getText: () => text,
        positionAt: (offset: number) => offset,
    };
    const [link] = new OrgLinkProvider().provideDocumentLinks(document as any, {} as any);
    const uri = decodeURIComponent(link.target!.toString());
    return JSON.parse(uri.slice(uri.indexOf('?') + 1)).file;
}

describe('OrgLinkProvider file links', () => {
    it('expands ~ to the home directory', () => {
        expect(linkTargetFile('[[file:~/projects/data]]')).toBe(path.join(os.homedir(), 'projects', 'data'));
    });

    it('still resolves relative paths against the document', () => {
        expect(linkTargetFile('[[file:sub/data]]')).toBe(path.resolve(path.sep, 'docs', 'sub', 'data'));
    });
});
