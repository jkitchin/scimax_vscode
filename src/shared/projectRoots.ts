/**
 * Folders too broad to be a scimax project.
 *
 * Every folder opened in VS Code is registered as a project, and with
 * scimax.db.includeProjects on, every project is an indexing root. Opening
 * the home directory once therefore indexed all of it: cloud-drive mirrors,
 * application caches, cloned repositories and build output, each adding its
 * own copies of TODOs to the agenda. The home directory and its ancestors
 * (/Users, /) are never auto-registered and never used as indexing roots.
 */

import * as os from 'os';
import * as path from 'path';

/** True for the home directory and any directory that contains it. */
export function isTooBroadForProject(dir: string, home: string = os.homedir()): boolean {
    const target = path.resolve(dir);
    const resolvedHome = path.resolve(home);
    if (target === resolvedHome) return true;
    const rel = path.relative(target, resolvedHome);
    // home is inside target when the relative path doesn't climb out of it
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
