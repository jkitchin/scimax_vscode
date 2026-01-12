/**
 * Jupyter Executor for Org Babel
 * Integrates Jupyter kernels with the Babel execution system
 */

import * as path from 'path';
import * as fs from 'fs';
import { getKernelManager } from './kernelManager';
import { findKernelForLanguage } from './kernelSpec';
import type { ExecutionOutput, DisplayDataContent } from './types';
import type { LanguageExecutor, ExecutionResult, ExecutionContext } from '../parser/orgBabel';

// =============================================================================
// Jupyter Executor
// =============================================================================

/**
 * Languages that should use Jupyter kernels
 * Maps org-mode language names to kernel language names
 */
const JUPYTER_LANGUAGES: Record<string, string> = {
    'python': 'python',
    'python3': 'python',
    'py': 'python',
    'ipython': 'python',
    'julia': 'julia',
    'jl': 'julia',
    'r': 'r',
    'R': 'r',
    'ruby': 'ruby',
    'rust': 'rust',
    'go': 'go',
    'golang': 'go',
    'c': 'c',
    'c++': 'c++',
    'cpp': 'c++',
    'java': 'java',
    'scala': 'scala',
    'haskell': 'haskell',
    'lua': 'lua',
    'perl': 'perl',
    'octave': 'octave',
    'matlab': 'matlab',
    'maxima': 'maxima',
    'sql': 'sql',
    'sqlite': 'sqlite',
};

/**
 * Check if a language should use Jupyter
 */
export function shouldUseJupyter(language: string): boolean {
    return language.toLowerCase() in JUPYTER_LANGUAGES;
}

/**
 * Get kernel language for org language
 */
function getKernelLanguage(orgLanguage: string): string {
    return JUPYTER_LANGUAGES[orgLanguage.toLowerCase()] || orgLanguage;
}

/**
 * Convert Jupyter output to Babel execution result
 */
function convertOutput(output: ExecutionOutput, context: ExecutionContext): ExecutionResult {
    // Check for error
    if (output.error) {
        return {
            success: false,
            stdout: output.stdout,
            stderr: output.stderr + '\n' + output.error.traceback.join('\n'),
            error: new Error(`${output.error.ename}: ${output.error.evalue}`),
            executionTime: 0,
        };
    }

    // Collect result text
    let resultText = output.stdout;

    // Add execute result if present
    if (output.result) {
        const data = output.result.data;

        // Prefer text/plain for inline results
        if (data['text/plain']) {
            if (resultText && !resultText.endsWith('\n')) {
                resultText += '\n';
            }
            resultText += data['text/plain'];
        }
    }

    // Handle rich output (images, HTML, etc.)
    const files: string[] = [];
    for (const displayData of output.displayData) {
        const file = saveDisplayData(displayData, context);
        if (file) {
            files.push(file);
        }
    }

    // Also check result for images
    if (output.result) {
        const file = saveDisplayData(output.result, context);
        if (file) {
            files.push(file);
        }
    }

    return {
        success: true,
        stdout: resultText.trim(),
        stderr: output.stderr.trim(),
        executionTime: 0,
        resultType: files.length > 0 ? 'file' : 'output',
        files,
    };
}

/**
 * Save display data (images, etc.) to files
 */
function saveDisplayData(
    displayData: DisplayDataContent | { data: Record<string, string> },
    context: ExecutionContext
): string | null {
    const data = displayData.data;
    const outputDir = context.cwd || process.cwd();

    // PNG image
    if (data['image/png']) {
        const filename = `output-${Date.now()}.png`;
        const filepath = path.join(outputDir, filename);
        const buffer = Buffer.from(data['image/png'], 'base64');
        fs.writeFileSync(filepath, buffer);
        return filename;
    }

    // SVG image
    if (data['image/svg+xml']) {
        const filename = `output-${Date.now()}.svg`;
        const filepath = path.join(outputDir, filename);
        fs.writeFileSync(filepath, data['image/svg+xml']);
        return filename;
    }

    // JPEG image
    if (data['image/jpeg']) {
        const filename = `output-${Date.now()}.jpg`;
        const filepath = path.join(outputDir, filename);
        const buffer = Buffer.from(data['image/jpeg'], 'base64');
        fs.writeFileSync(filepath, buffer);
        return filename;
    }

    // PDF
    if (data['application/pdf']) {
        const filename = `output-${Date.now()}.pdf`;
        const filepath = path.join(outputDir, filename);
        const buffer = Buffer.from(data['application/pdf'], 'base64');
        fs.writeFileSync(filepath, buffer);
        return filename;
    }

    return null;
}

/**
 * Jupyter executor for Babel
 */
export const jupyterExecutor: LanguageExecutor = {
    languages: Object.keys(JUPYTER_LANGUAGES),

    async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
        const manager = getKernelManager();

        // Determine language (from context or default to python)
        const language = getKernelLanguage((context as any).language || 'python');

        // Determine session name
        const sessionName = context.session || `${language}-default`;

        try {
            // Check if kernel is available for this language
            const kernelSpec = await findKernelForLanguage(language);
            if (!kernelSpec) {
                return {
                    success: false,
                    error: new Error(`No Jupyter kernel found for language: ${language}`),
                };
            }

            // Execute code
            const startTime = Date.now();
            const output = await manager.executeOnSession(
                sessionName,
                language,
                code,
                {
                    silent: false,
                    storeHistory: true,
                }
            );

            const result = convertOutput(output, context);
            result.executionTime = Date.now() - startTime;

            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    },

    async initSession(sessionName: string, context: ExecutionContext): Promise<void> {
        const manager = getKernelManager();
        const language = getKernelLanguage((context as any).language || 'python');
        await manager.startKernel(language, sessionName);
    },

    async closeSession(sessionName: string): Promise<void> {
        const manager = getKernelManager();
        const kernelId = manager.getKernelForSession(sessionName);
        if (kernelId) {
            await manager.stopKernel(kernelId);
        }
    },

    async isAvailable(): Promise<boolean> {
        try {
            const manager = getKernelManager();
            const specs = await manager.getAvailableKernels();
            return specs.length > 0;
        } catch {
            return false;
        }
    },
};

/**
 * Create a language-specific Jupyter executor
 */
export function createJupyterExecutor(language: string): LanguageExecutor {
    const kernelLanguage = getKernelLanguage(language);

    return {
        languages: [language],

        async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
            const contextWithLanguage = { ...context, language: kernelLanguage };
            return jupyterExecutor.execute(code, contextWithLanguage);
        },

        async initSession(sessionName: string, context: ExecutionContext): Promise<void> {
            const contextWithLanguage = { ...context, language: kernelLanguage };
            return jupyterExecutor.initSession?.(sessionName, contextWithLanguage);
        },

        async closeSession(sessionName: string): Promise<void> {
            return jupyterExecutor.closeSession?.(sessionName);
        },

        async isAvailable(): Promise<boolean> {
            try {
                const spec = await findKernelForLanguage(kernelLanguage);
                return spec !== null;
            } catch {
                return false;
            }
        },
    };
}

// =============================================================================
// Specialized Executors
// =============================================================================

/**
 * Python Jupyter executor
 */
export const pythonJupyterExecutor = createJupyterExecutor('python');

/**
 * Julia Jupyter executor
 */
export const juliaJupyterExecutor = createJupyterExecutor('julia');

/**
 * R Jupyter executor
 */
export const rJupyterExecutor = createJupyterExecutor('r');
