/**
 * Jupyter Kernel Manager
 * Manages kernel lifecycle: start, stop, restart, and session management
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { KernelConnection, KernelConnectionEvents } from './kernelConnection';
import { findKernelSpec, findKernelForLanguage, discoverKernelSpecsViaJupyter } from './kernelSpec';
import type {
    KernelSpec,
    ConnectionInfo,
    KernelState,
    KernelInfo,
    ExecutionOutput,
} from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Managed kernel instance
 */
interface ManagedKernel {
    /** Unique kernel ID */
    id: string;
    /** Session name */
    sessionName: string;
    /** Kernel spec */
    spec: KernelSpec;
    /** Connection info */
    connection: ConnectionInfo;
    /** Connection file path */
    connectionFile: string;
    /** Kernel process */
    process: ChildProcess | null;
    /** ZMQ connection */
    zmqConnection: KernelConnection | null;
    /** Current state */
    state: KernelState;
    /** Start time */
    startedAt: Date;
    /** Language */
    language: string;
}

/**
 * Kernel manager events
 */
export interface KernelManagerEvents {
    kernelStarted: (kernel: KernelInfo) => void;
    kernelStopped: (kernelId: string) => void;
    kernelStateChanged: (kernelId: string, state: KernelState) => void;
    kernelError: (kernelId: string, error: Error) => void;
    output: (kernelId: string, type: 'stdout' | 'stderr', text: string) => void;
}

// =============================================================================
// Kernel Manager
// =============================================================================

/**
 * Manages multiple Jupyter kernel instances
 */
export class KernelManager extends EventEmitter {
    private kernels: Map<string, ManagedKernel> = new Map();
    private sessionKernels: Map<string, string> = new Map(); // session -> kernelId
    private runtimeDir: string;

    constructor() {
        super();
        this.runtimeDir = this.getJupyterRuntimeDir();
        this.ensureRuntimeDir();
    }

    /**
     * Get Jupyter runtime directory
     */
    private getJupyterRuntimeDir(): string {
        // Check environment variable
        const envDir = process.env.JUPYTER_RUNTIME_DIR;
        if (envDir) return envDir;

        // Default locations
        if (process.platform === 'win32') {
            const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
            return path.join(appData, 'jupyter', 'runtime');
        } else if (process.platform === 'darwin') {
            return path.join(os.homedir(), 'Library', 'Jupyter', 'runtime');
        } else {
            const xdgRuntime = process.env.XDG_RUNTIME_DIR;
            if (xdgRuntime) {
                return path.join(xdgRuntime, 'jupyter');
            }
            return path.join(os.homedir(), '.local', 'share', 'jupyter', 'runtime');
        }
    }

    /**
     * Ensure runtime directory exists
     */
    private ensureRuntimeDir(): void {
        if (!fs.existsSync(this.runtimeDir)) {
            fs.mkdirSync(this.runtimeDir, { recursive: true });
        }
    }

    /**
     * Generate connection info
     */
    private generateConnectionInfo(): ConnectionInfo {
        // Find available ports (use random high ports)
        const basePort = 10000 + Math.floor(Math.random() * 50000);

        return {
            ip: '127.0.0.1',
            transport: 'tcp',
            shell_port: basePort,
            iopub_port: basePort + 1,
            stdin_port: basePort + 2,
            control_port: basePort + 3,
            hb_port: basePort + 4,
            key: crypto.randomBytes(16).toString('hex'),
            signature_scheme: 'hmac-sha256',
        };
    }

    /**
     * Write connection file
     */
    private writeConnectionFile(kernelId: string, connection: ConnectionInfo): string {
        const filename = `kernel-${kernelId}.json`;
        const filepath = path.join(this.runtimeDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(connection, null, 2));

        return filepath;
    }

    /**
     * Delete connection file
     */
    private deleteConnectionFile(filepath: string): void {
        try {
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        } catch {
            // Ignore errors
        }
    }

    /**
     * Start a kernel
     * @param specNameOrLanguage - Kernel spec name or language
     * @param sessionName - Session name for grouping kernels
     * @param cwd - Working directory for the kernel process
     */
    public async startKernel(
        specNameOrLanguage: string,
        sessionName: string = 'default',
        cwd?: string
    ): Promise<string> {
        // Find kernel spec
        let spec = await findKernelSpec(specNameOrLanguage);
        if (!spec) {
            spec = await findKernelForLanguage(specNameOrLanguage);
        }
        if (!spec) {
            throw new Error(`No kernel found for: ${specNameOrLanguage}`);
        }

        // Check if session already has a kernel
        const existingKernelId = this.sessionKernels.get(sessionName);
        if (existingKernelId) {
            const existing = this.kernels.get(existingKernelId);
            if (existing && existing.state !== 'dead') {
                return existingKernelId;
            }
        }

        // Generate kernel ID and connection info
        const kernelId = uuidv4();
        const connection = this.generateConnectionInfo();
        const connectionFile = this.writeConnectionFile(kernelId, connection);

        // Build kernel launch command
        const argv = spec.argv.map(arg => {
            return arg.replace('{connection_file}', connectionFile);
        });

        // Start kernel process
        const kernelProcess = spawn(argv[0], argv.slice(1), {
            env: { ...process.env, ...spec.env },
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false,
            cwd: cwd || process.cwd(),
        });

        // Create managed kernel
        const kernel: ManagedKernel = {
            id: kernelId,
            sessionName,
            spec,
            connection,
            connectionFile,
            process: kernelProcess,
            zmqConnection: null,
            state: 'starting',
            startedAt: new Date(),
            language: spec.language,
        };

        this.kernels.set(kernelId, kernel);
        this.sessionKernels.set(sessionName, kernelId);

        // Handle process output
        kernelProcess.stdout?.on('data', (data) => {
            this.emit('output', kernelId, 'stdout', data.toString());
        });

        kernelProcess.stderr?.on('data', (data) => {
            this.emit('output', kernelId, 'stderr', data.toString());
        });

        // Handle process exit
        kernelProcess.on('exit', (code, signal) => {
            kernel.state = 'dead';
            kernel.process = null;
            this.emit('kernelStateChanged', kernelId, 'dead');
            this.emit('kernelStopped', kernelId);
        });

        kernelProcess.on('error', (error) => {
            kernel.state = 'dead';
            this.emit('kernelError', kernelId, error);
        });

        // Wait for kernel to be ready
        await this.waitForKernelReady(kernel);

        // Connect via ZMQ
        const zmqConnection = new KernelConnection(connection, {
            onStatus: (state) => {
                kernel.state = state;
                this.emit('kernelStateChanged', kernelId, state);
            },
            onStream: (name, text) => {
                this.emit('output', kernelId, name, text);
            },
        });

        await zmqConnection.connect();
        kernel.zmqConnection = zmqConnection;
        kernel.state = 'idle';

        this.emit('kernelStarted', this.getKernelInfo(kernelId)!);
        this.emit('kernelStateChanged', kernelId, 'idle');

        return kernelId;
    }

    /**
     * Wait for kernel to be ready
     */
    private async waitForKernelReady(kernel: ManagedKernel, timeout: number = 30000): Promise<void> {
        const startTime = Date.now();

        // Wait for connection file to be populated and kernel to start
        while (Date.now() - startTime < timeout) {
            // Check if process is still alive
            if (!kernel.process || kernel.process.exitCode !== null) {
                throw new Error('Kernel process died during startup');
            }

            // Try to read connection file to verify ports
            try {
                const content = fs.readFileSync(kernel.connectionFile, 'utf-8');
                const conn = JSON.parse(content);
                if (conn.shell_port && conn.iopub_port) {
                    // Give kernel a moment to bind to ports
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return;
                }
            } catch {
                // File not ready yet
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        throw new Error('Timeout waiting for kernel to start');
    }

    /**
     * Stop a kernel
     */
    public async stopKernel(kernelId: string): Promise<void> {
        const kernel = this.kernels.get(kernelId);
        if (!kernel) return;

        // Try graceful shutdown via ZMQ
        if (kernel.zmqConnection) {
            try {
                await kernel.zmqConnection.shutdown(false);
            } catch {
                // Ignore errors
            }
            await kernel.zmqConnection.disconnect();
        }

        // Kill process if still running
        if (kernel.process) {
            kernel.process.kill('SIGTERM');

            // Force kill after timeout
            setTimeout(() => {
                if (kernel.process) {
                    kernel.process.kill('SIGKILL');
                }
            }, 5000);
        }

        // Clean up
        this.deleteConnectionFile(kernel.connectionFile);
        this.sessionKernels.delete(kernel.sessionName);
        this.kernels.delete(kernelId);

        this.emit('kernelStopped', kernelId);
    }

    /**
     * Restart a kernel
     */
    public async restartKernel(kernelId: string): Promise<string> {
        const kernel = this.kernels.get(kernelId);
        if (!kernel) {
            throw new Error(`Kernel not found: ${kernelId}`);
        }

        const sessionName = kernel.sessionName;
        const specName = kernel.spec.name;

        await this.stopKernel(kernelId);
        return this.startKernel(specName, sessionName);
    }

    /**
     * Interrupt a kernel
     */
    public async interruptKernel(kernelId: string): Promise<void> {
        const kernel = this.kernels.get(kernelId);
        if (!kernel) {
            throw new Error(`Kernel not found: ${kernelId}`);
        }

        // Try ZMQ interrupt
        if (kernel.zmqConnection) {
            try {
                await kernel.zmqConnection.interrupt();
                return;
            } catch {
                // Fall through to signal
            }
        }

        // Send SIGINT to process
        if (kernel.process && kernel.spec.interruptMode !== 'message') {
            kernel.process.kill('SIGINT');
        }
    }

    /**
     * Execute code on a kernel
     */
    public async execute(
        kernelId: string,
        code: string,
        options: { silent?: boolean; storeHistory?: boolean } = {}
    ): Promise<ExecutionOutput> {
        const kernel = this.kernels.get(kernelId);
        if (!kernel || !kernel.zmqConnection) {
            throw new Error(`Kernel not connected: ${kernelId}`);
        }

        return kernel.zmqConnection.execute(code, options);
    }

    /**
     * Execute code on a session (start kernel if needed)
     * @param sessionName - Session name
     * @param language - Kernel language
     * @param code - Code to execute
     * @param options - Execution options
     * @param cwd - Working directory for the kernel (used if starting a new kernel)
     */
    public async executeOnSession(
        sessionName: string,
        language: string,
        code: string,
        options: { silent?: boolean; storeHistory?: boolean } = {},
        cwd?: string
    ): Promise<ExecutionOutput> {
        // Get or start kernel for session
        let kernelId = this.sessionKernels.get(sessionName);
        if (!kernelId || !this.kernels.has(kernelId)) {
            kernelId = await this.startKernel(language, sessionName, cwd);
        }

        return this.execute(kernelId, code, options);
    }

    /**
     * Get kernel for session
     */
    public getKernelForSession(sessionName: string): string | undefined {
        return this.sessionKernels.get(sessionName);
    }

    /**
     * Get kernel info
     */
    public getKernelInfo(kernelId: string): KernelInfo | null {
        const kernel = this.kernels.get(kernelId);
        if (!kernel) return null;

        return {
            spec: kernel.spec,
            connection: kernel.connection,
            state: kernel.state,
            pid: kernel.process?.pid,
            sessionId: kernel.sessionName,
        };
    }

    /**
     * Get all kernel IDs
     */
    public getKernelIds(): string[] {
        return Array.from(this.kernels.keys());
    }

    /**
     * Get all sessions
     */
    public getSessions(): Array<{ name: string; kernelId: string; language: string; state: KernelState }> {
        const sessions: Array<{ name: string; kernelId: string; language: string; state: KernelState }> = [];

        for (const [sessionName, kernelId] of this.sessionKernels) {
            const kernel = this.kernels.get(kernelId);
            if (kernel) {
                sessions.push({
                    name: sessionName,
                    kernelId,
                    language: kernel.language,
                    state: kernel.state,
                });
            }
        }

        return sessions;
    }

    /**
     * Get available kernel specs
     */
    public async getAvailableKernels(): Promise<KernelSpec[]> {
        const specs = await discoverKernelSpecsViaJupyter();
        return Array.from(specs.values());
    }

    /**
     * Shutdown all kernels
     */
    public async shutdownAll(): Promise<void> {
        const kernelIds = Array.from(this.kernels.keys());
        await Promise.all(kernelIds.map(id => this.stopKernel(id)));
    }

    /**
     * Get connection for kernel
     */
    public getConnection(kernelId: string): KernelConnection | null {
        const kernel = this.kernels.get(kernelId);
        return kernel?.zmqConnection || null;
    }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let kernelManagerInstance: KernelManager | null = null;

/**
 * Get the kernel manager singleton
 */
export function getKernelManager(): KernelManager {
    if (!kernelManagerInstance) {
        kernelManagerInstance = new KernelManager();
    }
    return kernelManagerInstance;
}

/**
 * Dispose of the kernel manager
 */
export async function disposeKernelManager(): Promise<void> {
    if (kernelManagerInstance) {
        await kernelManagerInstance.shutdownAll();
        kernelManagerInstance = null;
    }
}
