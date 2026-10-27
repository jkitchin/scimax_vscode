/**
 * Downloads the presenter tools need, cached on disk: KaTeX fonts, and the
 * Pyodide files an offline deck (`presenter: offline`) embeds.
 *
 * No VS Code dependency, so the extension and the CLI share it; each passes
 * its own cache folder (the extension's global storage).
 */

import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { OfflinePlan, planOfflinePython, pyodideBaseUrl, PyodideLock } from './presenterBundle';

/** Download a file, failing on an HTTP error. */
export async function download(url: string, timeoutMs: number): Promise<Buffer> {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
        throw new Error(`Could not download ${url}: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/** Download a KaTeX font once, caching it in `cacheDir`/marp-present-fonts. */
export async function fetchFontCached(cacheDir: string, url: string): Promise<Buffer> {
    const dir = path.join(cacheDir, 'marp-present-fonts');
    const file = path.join(dir, path.basename(new URL(url).pathname));
    try {
        return await fs.promises.readFile(file);
    } catch {
        // Not cached yet.
    }
    const data = await download(url, 30000);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(file, data);
    return data;
}

export interface OfflinePythonFiles {
    files: Record<string, Buffer>;
    plan: OfflinePlan;
    /** The Pyodide release, e.g. v0.27.2 */
    version: string;
}

/**
 * The Pyodide files an offline deck embeds: Pyodide itself and the packages
 * its run cells import. They are downloaded once into `cacheDir`/pyodide
 * (wheels checked against the lock file's sha256), so later builds work
 * without a network. `downloadAll` is called with the files that are not
 * cached yet and fetches them (the extension shows progress around it).
 */
export async function offlinePythonFiles(
    pycellsPath: string,
    cacheDir: string,
    markdown: string,
    downloadAll: (missing: string[], fetchOne: (name: string) => Promise<Buffer>) => Promise<void> =
    async (missing, fetchOne) => {
        for (const name of missing) {
            await fetchOne(name);
        }
    }
): Promise<OfflinePythonFiles> {
    const pycells = await fs.promises.readFile(pycellsPath, 'utf8');
    const base = pyodideBaseUrl(pycells);
    const version = base.match(/\/(v[^/]+)\//)?.[1] ?? 'pyodide';
    const dir = path.join(cacheDir, 'pyodide', version);
    await fs.promises.mkdir(dir, { recursive: true });

    const cached = async (name: string, sha256?: string): Promise<Buffer | undefined> => {
        try {
            const data = await fs.promises.readFile(path.join(dir, name));
            if (!sha256 || createHash('sha256').update(data).digest('hex') === sha256) {
                return data;
            }
        } catch {
            // Not cached yet.
        }
        return undefined;
    };
    const save = async (name: string, data: Buffer): Promise<void> => {
        const tmp = path.join(dir, `.${name}.${randomBytes(8).toString('hex')}`);
        await fs.promises.writeFile(tmp, data);
        await fs.promises.rename(tmp, path.join(dir, name));
    };

    let lockData = await cached('pyodide-lock.json');
    if (!lockData) {
        lockData = await download(base + 'pyodide-lock.json', 60000);
        await save('pyodide-lock.json', lockData);
    }
    const lock = JSON.parse(lockData.toString('utf8')) as PyodideLock;
    const plan = planOfflinePython(markdown, lock);
    const sha = new Map(plan.packages.map(name => [lock.packages[name].file_name, lock.packages[name].sha256]));

    const files: Record<string, Buffer> = {};
    const missing: string[] = [];
    for (const name of plan.files) {
        const data = await cached(name, sha.get(name));
        if (data) {
            files[name] = data;
        } else {
            missing.push(name);
        }
    }
    if (missing.length > 0) {
        await downloadAll(missing, async name => {
            const data = await download(base + name, 300000);
            const expected = sha.get(name);
            if (expected && createHash('sha256').update(data).digest('hex') !== expected) {
                throw new Error(`${name} does not match its checksum in pyodide-lock.json`);
            }
            await save(name, data);
            files[name] = data;
            return data;
        });
    }
    return { files, plan, version };
}
