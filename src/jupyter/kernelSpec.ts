/**
 * Jupyter Kernel Specification Discovery
 * Discovers installed kernels from standard locations
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { KernelSpec } from './types';

const execAsync = promisify(exec);

// =============================================================================
// Kernel Spec Discovery
// =============================================================================

/**
 * Standard kernel spec directories
 */
function getKernelSpecDirs(): string[] {
    const dirs: string[] = [];
    const homeDir = os.homedir();

    if (process.platform === 'win32') {
        // Windows locations
        const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
        const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';

        dirs.push(
            path.join(appData, 'jupyter', 'kernels'),
            path.join(programData, 'jupyter', 'kernels'),
        );

        // Conda environments
        const condaPrefix = process.env.CONDA_PREFIX;
        if (condaPrefix) {
            dirs.push(path.join(condaPrefix, 'share', 'jupyter', 'kernels'));
        }
    } else {
        // Unix/Linux/macOS locations
        dirs.push(
            path.join(homeDir, '.local', 'share', 'jupyter', 'kernels'),
            '/usr/local/share/jupyter/kernels',
            '/usr/share/jupyter/kernels',
        );

        // macOS specific
        if (process.platform === 'darwin') {
            dirs.push(path.join(homeDir, 'Library', 'Jupyter', 'kernels'));
        }

        // Conda environments
        const condaPrefix = process.env.CONDA_PREFIX;
        if (condaPrefix) {
            dirs.push(path.join(condaPrefix, 'share', 'jupyter', 'kernels'));
        }

        // Virtual environments
        const virtualEnv = process.env.VIRTUAL_ENV;
        if (virtualEnv) {
            dirs.push(path.join(virtualEnv, 'share', 'jupyter', 'kernels'));
        }
    }

    // Add XDG_DATA_HOME if set (Unix)
    const xdgDataHome = process.env.XDG_DATA_HOME;
    if (xdgDataHome) {
        dirs.push(path.join(xdgDataHome, 'jupyter', 'kernels'));
    }

    // Add Jupyter data dir from environment
    const jupyterDataDir = process.env.JUPYTER_DATA_DIR;
    if (jupyterDataDir) {
        dirs.push(path.join(jupyterDataDir, 'kernels'));
    }

    return dirs.filter(dir => {
        try {
            return fs.existsSync(dir);
        } catch {
            return false;
        }
    });
}

/**
 * Parse kernel.json file
 */
function parseKernelJson(kernelDir: string, name: string): KernelSpec | null {
    const kernelJsonPath = path.join(kernelDir, 'kernel.json');

    try {
        if (!fs.existsSync(kernelJsonPath)) {
            return null;
        }

        const content = fs.readFileSync(kernelJsonPath, 'utf-8');
        const json = JSON.parse(content);

        return {
            name,
            displayName: json.display_name || name,
            language: json.language || 'unknown',
            resourceDir: kernelDir,
            argv: json.argv || [],
            env: json.env,
            interruptMode: json.interrupt_mode,
            metadata: json.metadata,
        };
    } catch (error) {
        console.error(`Failed to parse kernel.json at ${kernelJsonPath}:`, error);
        return null;
    }
}

/**
 * Discover all installed kernel specs by scanning directories
 */
export async function discoverKernelSpecs(): Promise<Map<string, KernelSpec>> {
    const specs = new Map<string, KernelSpec>();
    const dirs = getKernelSpecDirs();

    for (const dir of dirs) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const kernelDir = path.join(dir, entry.name);
                    const spec = parseKernelJson(kernelDir, entry.name);

                    if (spec && !specs.has(spec.name)) {
                        specs.set(spec.name, spec);
                    }
                }
            }
        } catch {
            // Directory doesn't exist or not readable
        }
    }

    return specs;
}

/**
 * Discover kernel specs using `jupyter kernelspec list` command
 * Falls back to directory scanning if command fails
 */
export async function discoverKernelSpecsViaJupyter(): Promise<Map<string, KernelSpec>> {
    try {
        const { stdout } = await execAsync('jupyter kernelspec list --json', {
            timeout: 10000,
        });

        const result = JSON.parse(stdout);
        const specs = new Map<string, KernelSpec>();

        if (result.kernelspecs) {
            for (const [name, data] of Object.entries(result.kernelspecs)) {
                const spec = data as any;
                specs.set(name, {
                    name,
                    displayName: spec.spec?.display_name || name,
                    language: spec.spec?.language || 'unknown',
                    resourceDir: spec.resource_dir || '',
                    argv: spec.spec?.argv || [],
                    env: spec.spec?.env,
                    interruptMode: spec.spec?.interrupt_mode,
                    metadata: spec.spec?.metadata,
                });
            }
        }

        return specs;
    } catch {
        // Fallback to directory scanning
        return discoverKernelSpecs();
    }
}

/**
 * Find a kernel spec by name
 */
export async function findKernelSpec(name: string): Promise<KernelSpec | null> {
    const specs = await discoverKernelSpecsViaJupyter();
    return specs.get(name) || null;
}

/**
 * Find kernel specs by language
 */
export async function findKernelSpecsByLanguage(language: string): Promise<KernelSpec[]> {
    const specs = await discoverKernelSpecsViaJupyter();
    const matches: KernelSpec[] = [];

    const normalizedLang = language.toLowerCase();

    for (const spec of specs.values()) {
        const specLang = spec.language.toLowerCase();
        if (specLang === normalizedLang || specLang.includes(normalizedLang)) {
            matches.push(spec);
        }
    }

    // Sort by priority: exact match first, then by name
    matches.sort((a, b) => {
        const aExact = a.language.toLowerCase() === normalizedLang;
        const bExact = b.language.toLowerCase() === normalizedLang;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return a.name.localeCompare(b.name);
    });

    return matches;
}

/**
 * Get default kernel for a language
 */
export async function getDefaultKernelForLanguage(language: string): Promise<KernelSpec | null> {
    const matches = await findKernelSpecsByLanguage(language);
    return matches.length > 0 ? matches[0] : null;
}

/**
 * Language to kernel name mapping for common cases
 */
const LANGUAGE_KERNEL_MAP: Record<string, string[]> = {
    'python': ['python3', 'python', 'python2'],
    'python3': ['python3', 'python'],
    'julia': ['julia-1.9', 'julia-1.8', 'julia-1.7', 'julia'],
    'r': ['ir', 'r'],
    'ruby': ['ruby'],
    'javascript': ['javascript', 'nodejs', 'node'],
    'typescript': ['typescript', 'tslab'],
    'rust': ['rust', 'evcxr'],
    'go': ['gophernotes', 'go'],
    'c': ['c', 'xeus-cling'],
    'c++': ['c++', 'xcpp', 'xeus-cling'],
    'cpp': ['c++', 'xcpp', 'xeus-cling'],
    'java': ['java', 'ijava'],
    'scala': ['scala', 'almond'],
    'haskell': ['haskell', 'ihaskell'],
    'lua': ['lua', 'ilua'],
    'perl': ['perl', 'iperl'],
    'bash': ['bash', 'sh'],
    'sh': ['bash', 'sh'],
    'shell': ['bash', 'sh'],
    'octave': ['octave'],
    'matlab': ['matlab', 'imatlab'],
    'maxima': ['maxima'],
    'sql': ['sql'],
    'sqlite': ['sqlite3'],
};

/**
 * Find best kernel for a source block language
 */
export async function findKernelForLanguage(language: string): Promise<KernelSpec | null> {
    const normalizedLang = language.toLowerCase();

    // First try direct language match
    let spec = await getDefaultKernelForLanguage(normalizedLang);
    if (spec) return spec;

    // Try mapped kernel names
    const mappedNames = LANGUAGE_KERNEL_MAP[normalizedLang];
    if (mappedNames) {
        const specs = await discoverKernelSpecsViaJupyter();
        for (const name of mappedNames) {
            if (specs.has(name)) {
                return specs.get(name)!;
            }
        }
    }

    return null;
}
