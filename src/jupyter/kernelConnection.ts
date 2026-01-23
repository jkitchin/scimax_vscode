/**
 * Jupyter Kernel ZMQ Connection
 * Handles low-level communication with Jupyter kernels via ZeroMQ
 */

import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
    ConnectionInfo,
    JupyterMessage,
    MessageHeader,
    ExecuteRequestContent,
    ExecuteReplyContent,
    InspectRequestContent,
    InspectReplyContent,
    CompleteRequestContent,
    CompleteReplyContent,
    KernelInfoReplyContent,
    ShutdownRequestContent,
    ShutdownReplyContent,
    IsCompleteRequestContent,
    IsCompleteReplyContent,
    StreamContent,
    DisplayDataContent,
    ExecuteResultContent,
    ErrorContent,
    StatusContent,
    ExecutionOutput,
    KernelState,
} from './types';

// ZeroMQ import - will be dynamically imported
let zmq: typeof import('zeromq') | null = null;
let zmqLoadError: Error | null = null;

/**
 * Load ZeroMQ module
 */
async function loadZmq(): Promise<typeof import('zeromq')> {
    if (zmqLoadError) {
        throw zmqLoadError;
    }
    if (!zmq) {
        try {
            zmq = await import('zeromq');
        } catch (error) {
            zmqLoadError = new Error(
                `Failed to load ZeroMQ native module. ` +
                `This usually means the module was compiled for a different Node.js version. ` +
                `For VS Code extensions, zeromq needs to be rebuilt for Electron. ` +
                `Run: npm run rebuild-zmq\n\n` +
                `Original error: ${error instanceof Error ? error.message : String(error)}`
            );
            throw zmqLoadError;
        }
    }
    return zmq;
}

/**
 * Check if ZeroMQ is available
 */
export async function isZmqAvailable(): Promise<boolean> {
    try {
        await loadZmq();
        return true;
    } catch {
        return false;
    }
}

/**
 * Get ZeroMQ load error if any
 */
export function getZmqLoadError(): Error | null {
    return zmqLoadError;
}

// =============================================================================
// Message Utilities
// =============================================================================

const PROTOCOL_VERSION = '5.3';
const DELIMITER = '<IDS|MSG>';
const DELIMITER_BYTES = Buffer.from(DELIMITER);

/**
 * Create a message header
 */
function createHeader(msgType: string, sessionId: string): MessageHeader {
    return {
        msg_id: uuidv4(),
        session: sessionId,
        username: 'vscode',
        date: new Date().toISOString(),
        msg_type: msgType,
        version: PROTOCOL_VERSION,
    };
}

/**
 * Sign a message using HMAC-SHA256
 */
function signMessage(key: string, parts: string[]): string {
    if (!key) return '';

    const hmac = crypto.createHmac('sha256', key);
    for (const part of parts) {
        hmac.update(part);
    }
    return hmac.digest('hex');
}

/**
 * Verify message signature
 */
function verifySignature(key: string, signature: string, parts: string[]): boolean {
    if (!key) return true;
    const expected = signMessage(key, parts);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Serialize a message for sending
 */
function serializeMessage<T>(
    msg: JupyterMessage<T>,
    key: string,
    identities: Buffer[] = []
): Buffer[] {
    const headerStr = JSON.stringify(msg.header);
    const parentStr = JSON.stringify(msg.parent_header);
    const metadataStr = JSON.stringify(msg.metadata);
    const contentStr = JSON.stringify(msg.content);

    const signature = signMessage(key, [headerStr, parentStr, metadataStr, contentStr]);

    const frames: Buffer[] = [
        ...identities,
        DELIMITER_BYTES,
        Buffer.from(signature),
        Buffer.from(headerStr),
        Buffer.from(parentStr),
        Buffer.from(metadataStr),
        Buffer.from(contentStr),
        ...(msg.buffers || []),
    ];

    return frames;
}

/**
 * Deserialize a received message
 */
function deserializeMessage<T>(frames: Buffer[], key: string): {
    identities: Buffer[];
    message: JupyterMessage<T>;
} | null {
    // Find delimiter
    let delimiterIndex = -1;
    for (let i = 0; i < frames.length; i++) {
        if (frames[i].equals(DELIMITER_BYTES)) {
            delimiterIndex = i;
            break;
        }
    }

    if (delimiterIndex === -1) {
        console.error('No delimiter found in message');
        return null;
    }

    const identities = frames.slice(0, delimiterIndex);
    const signature = frames[delimiterIndex + 1].toString();
    const headerStr = frames[delimiterIndex + 2].toString();
    const parentStr = frames[delimiterIndex + 3].toString();
    const metadataStr = frames[delimiterIndex + 4].toString();
    const contentStr = frames[delimiterIndex + 5].toString();
    const buffers = frames.slice(delimiterIndex + 6);

    // Verify signature
    if (key && !verifySignature(key, signature, [headerStr, parentStr, metadataStr, contentStr])) {
        console.error('Invalid message signature');
        return null;
    }

    try {
        const message: JupyterMessage<T> = {
            header: JSON.parse(headerStr),
            parent_header: JSON.parse(parentStr),
            metadata: JSON.parse(metadataStr),
            content: JSON.parse(contentStr),
            buffers: buffers.length > 0 ? buffers : undefined,
        };

        return { identities, message };
    } catch (error) {
        console.error('Failed to parse message:', error);
        return null;
    }
}

// =============================================================================
// Kernel Connection Class
// =============================================================================

/**
 * Event handlers for kernel events
 */
export interface KernelConnectionEvents {
    onStatus?: (state: KernelState) => void;
    onStream?: (name: 'stdout' | 'stderr', text: string) => void;
    onDisplayData?: (data: DisplayDataContent) => void;
    onExecuteResult?: (data: ExecuteResultContent) => void;
    onError?: (error: ErrorContent) => void;
    onInputRequest?: (prompt: string, password: boolean) => Promise<string>;
}

/**
 * Pending request tracker
 */
interface PendingRequest<T> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    output: ExecutionOutput;
}

/**
 * ZMQ connection to a Jupyter kernel
 */
export class KernelConnection {
    private connection: ConnectionInfo;
    private sessionId: string;
    private events: KernelConnectionEvents;

    // ZMQ sockets
    private shellSocket: any = null;
    private iopubSocket: any = null;
    private stdinSocket: any = null;
    private controlSocket: any = null;
    private hbSocket: any = null;

    // State
    private connected: boolean = false;
    private state: KernelState = 'unknown';
    private pendingRequests: Map<string, PendingRequest<any>> = new Map();
    private iopubListening: boolean = false;

    constructor(connection: ConnectionInfo, events: KernelConnectionEvents = {}) {
        this.connection = connection;
        this.sessionId = uuidv4();
        this.events = events;
    }

    /**
     * Get current kernel state
     */
    public getState(): KernelState {
        return this.state;
    }

    /**
     * Check if connected
     */
    public isConnected(): boolean {
        return this.connected;
    }

    /**
     * Connect to the kernel
     */
    public async connect(): Promise<void> {
        if (this.connected) return;

        const zmqModule = await loadZmq();

        const { ip, transport, shell_port, iopub_port, stdin_port, control_port } = this.connection;
        const baseUrl = `${transport}://${ip}`;

        // Create sockets
        this.shellSocket = new zmqModule.Dealer();
        this.iopubSocket = new zmqModule.Subscriber();
        this.stdinSocket = new zmqModule.Dealer();
        this.controlSocket = new zmqModule.Dealer();

        // Set identity for DEALER sockets
        const identity = Buffer.from(this.sessionId);
        this.shellSocket.routingId = identity;
        this.stdinSocket.routingId = identity;
        this.controlSocket.routingId = identity;

        // Connect sockets with error handling - clean up on failure
        try {
            await this.shellSocket.connect(`${baseUrl}:${shell_port}`);
            await this.iopubSocket.connect(`${baseUrl}:${iopub_port}`);
            await this.stdinSocket.connect(`${baseUrl}:${stdin_port}`);
            await this.controlSocket.connect(`${baseUrl}:${control_port}`);
        } catch (error) {
            // Clean up any sockets that were created/connected before the failure
            this.cleanupSockets();
            throw new Error(`Failed to connect to kernel: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Subscribe to all IOPub messages
        this.iopubSocket.subscribe('');

        this.connected = true;

        // Start listening for IOPub messages
        this.startIopubListener();
    }

    /**
     * Clean up all sockets (helper for error handling and disconnect)
     */
    private cleanupSockets(): void {
        if (this.shellSocket) {
            try { this.shellSocket.close(); } catch { /* ignore close errors */ }
            this.shellSocket = null;
        }
        if (this.iopubSocket) {
            try { this.iopubSocket.close(); } catch { /* ignore close errors */ }
            this.iopubSocket = null;
        }
        if (this.stdinSocket) {
            try { this.stdinSocket.close(); } catch { /* ignore close errors */ }
            this.stdinSocket = null;
        }
        if (this.controlSocket) {
            try { this.controlSocket.close(); } catch { /* ignore close errors */ }
            this.controlSocket = null;
        }
        if (this.hbSocket) {
            try { this.hbSocket.close(); } catch { /* ignore close errors */ }
            this.hbSocket = null;
        }
    }

    /**
     * Disconnect from the kernel
     */
    public async disconnect(): Promise<void> {
        if (!this.connected) return;

        this.iopubListening = false;
        this.connected = false;

        // Close all sockets
        this.cleanupSockets();

        // Reject pending requests
        for (const [, pending] of this.pendingRequests) {
            pending.reject(new Error('Kernel disconnected'));
        }
        this.pendingRequests.clear();
    }

    /**
     * Start listening for IOPub messages
     */
    private async startIopubListener(): Promise<void> {
        if (this.iopubListening) return;
        this.iopubListening = true;

        try {
            for await (const frames of this.iopubSocket) {
                if (!this.iopubListening) break;

                const result = deserializeMessage<any>(frames as Buffer[], this.connection.key);
                if (!result) continue;

                const { message } = result;
                this.handleIopubMessage(message);
            }
        } catch (error) {
            if (this.iopubListening) {
                console.error('IOPub listener error:', error);
            }
        }
    }

    /**
     * Handle IOPub message
     */
    private handleIopubMessage(message: JupyterMessage<any>): void {
        const msgType = message.header.msg_type;
        const parentMsgId = (message.parent_header as MessageHeader)?.msg_id;

        switch (msgType) {
            case 'status':
                const status = message.content as StatusContent;
                this.state = status.execution_state === 'starting' ? 'starting'
                    : status.execution_state === 'busy' ? 'busy'
                    : status.execution_state === 'idle' ? 'idle'
                    : 'unknown';
                this.events.onStatus?.(this.state);
                break;

            case 'stream':
                const stream = message.content as StreamContent;
                this.events.onStream?.(stream.name, stream.text);
                // Append to pending request output
                if (parentMsgId && this.pendingRequests.has(parentMsgId)) {
                    const pending = this.pendingRequests.get(parentMsgId)!;
                    if (stream.name === 'stdout') {
                        pending.output.stdout += stream.text;
                    } else {
                        pending.output.stderr += stream.text;
                    }
                }
                break;

            case 'display_data':
            case 'update_display_data':
                const displayData = message.content as DisplayDataContent;
                this.events.onDisplayData?.(displayData);
                if (parentMsgId && this.pendingRequests.has(parentMsgId)) {
                    this.pendingRequests.get(parentMsgId)!.output.displayData.push(displayData);
                }
                break;

            case 'execute_result':
                const result = message.content as ExecuteResultContent;
                this.events.onExecuteResult?.(result);
                if (parentMsgId && this.pendingRequests.has(parentMsgId)) {
                    this.pendingRequests.get(parentMsgId)!.output.result = result;
                    this.pendingRequests.get(parentMsgId)!.output.executionCount = result.execution_count;
                }
                break;

            case 'error':
                const error = message.content as ErrorContent;
                this.events.onError?.(error);
                if (parentMsgId && this.pendingRequests.has(parentMsgId)) {
                    this.pendingRequests.get(parentMsgId)!.output.error = error;
                }
                break;

            case 'execute_input':
                // Re-broadcast of input, can be ignored
                break;

            case 'clear_output':
                // Clear output signal
                break;

            default:
                // Unknown message type
                break;
        }
    }

    /**
     * Send a message and wait for reply
     */
    private async sendRequest<TReq, TRep>(
        socket: any,
        msgType: string,
        content: TReq,
        expectReply: boolean = true
    ): Promise<JupyterMessage<TRep>> {
        const header = createHeader(msgType, this.sessionId);

        const message: JupyterMessage<TReq> = {
            header,
            parent_header: {},
            metadata: {},
            content,
        };

        const frames = serializeMessage(message, this.connection.key);

        // Send message
        await socket.send(frames);

        if (!expectReply) {
            return message as any;
        }

        // Wait for reply
        const replyFrames = await socket.receive();
        const result = deserializeMessage<TRep>(replyFrames as Buffer[], this.connection.key);

        if (!result) {
            throw new Error('Failed to parse reply');
        }

        return result.message;
    }

    /**
     * Execute code
     */
    public async execute(
        code: string,
        options: {
            silent?: boolean;
            storeHistory?: boolean;
            allowStdin?: boolean;
            stopOnError?: boolean;
        } = {}
    ): Promise<ExecutionOutput> {
        if (!this.connected) {
            throw new Error('Not connected to kernel');
        }

        const content: ExecuteRequestContent = {
            code,
            silent: options.silent ?? false,
            store_history: options.storeHistory ?? true,
            user_expressions: {},
            allow_stdin: options.allowStdin ?? false,
            stop_on_error: options.stopOnError ?? true,
        };

        const header = createHeader('execute_request', this.sessionId);
        const message: JupyterMessage<ExecuteRequestContent> = {
            header,
            parent_header: {},
            metadata: {},
            content,
        };

        // Create output collector
        const output: ExecutionOutput = {
            stdout: '',
            stderr: '',
            displayData: [],
        };

        // Create pending request
        const pending = new Promise<ExecutionOutput>((resolve, reject) => {
            this.pendingRequests.set(header.msg_id, { resolve, reject, output });
        });

        // Send message
        const frames = serializeMessage(message, this.connection.key);
        await this.shellSocket.send(frames);

        // Wait for reply
        const replyFrames = await this.shellSocket.receive();
        const result = deserializeMessage<ExecuteReplyContent>(
            replyFrames as Buffer[],
            this.connection.key
        );

        if (!result) {
            this.pendingRequests.delete(header.msg_id);
            throw new Error('Failed to parse execute reply');
        }

        const reply = result.message.content;

        // Wait a bit for IOPub messages to arrive
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get collected output
        const collectedOutput = this.pendingRequests.get(header.msg_id)?.output || output;
        this.pendingRequests.delete(header.msg_id);

        if (reply.status === 'error') {
            collectedOutput.error = {
                ename: reply.ename || 'Error',
                evalue: reply.evalue || '',
                traceback: reply.traceback || [],
            };
        }

        collectedOutput.executionCount = reply.execution_count;

        return collectedOutput;
    }

    /**
     * Get code completions
     */
    public async complete(code: string, cursorPos: number): Promise<CompleteReplyContent> {
        if (!this.connected) {
            throw new Error('Not connected to kernel');
        }

        const content: CompleteRequestContent = {
            code,
            cursor_pos: cursorPos,
        };

        const reply = await this.sendRequest<CompleteRequestContent, CompleteReplyContent>(
            this.shellSocket,
            'complete_request',
            content
        );

        return reply.content;
    }

    /**
     * Inspect code (get documentation)
     */
    public async inspect(
        code: string,
        cursorPos: number,
        detailLevel: 0 | 1 = 0
    ): Promise<InspectReplyContent> {
        if (!this.connected) {
            throw new Error('Not connected to kernel');
        }

        const content: InspectRequestContent = {
            code,
            cursor_pos: cursorPos,
            detail_level: detailLevel,
        };

        const reply = await this.sendRequest<InspectRequestContent, InspectReplyContent>(
            this.shellSocket,
            'inspect_request',
            content
        );

        return reply.content;
    }

    /**
     * Check if code is complete
     */
    public async isComplete(code: string): Promise<IsCompleteReplyContent> {
        if (!this.connected) {
            throw new Error('Not connected to kernel');
        }

        const content: IsCompleteRequestContent = { code };

        const reply = await this.sendRequest<IsCompleteRequestContent, IsCompleteReplyContent>(
            this.shellSocket,
            'is_complete_request',
            content
        );

        return reply.content;
    }

    /**
     * Get kernel info
     */
    public async kernelInfo(): Promise<KernelInfoReplyContent> {
        if (!this.connected) {
            throw new Error('Not connected to kernel');
        }

        const reply = await this.sendRequest<Record<string, never>, KernelInfoReplyContent>(
            this.shellSocket,
            'kernel_info_request',
            {}
        );

        return reply.content;
    }

    /**
     * Interrupt the kernel
     */
    public async interrupt(): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to kernel');
        }

        await this.sendRequest<Record<string, never>, Record<string, never>>(
            this.controlSocket,
            'interrupt_request',
            {},
            false
        );
    }

    /**
     * Shutdown the kernel
     */
    public async shutdown(restart: boolean = false): Promise<ShutdownReplyContent> {
        if (!this.connected) {
            throw new Error('Not connected to kernel');
        }

        const content: ShutdownRequestContent = { restart };

        const reply = await this.sendRequest<ShutdownRequestContent, ShutdownReplyContent>(
            this.controlSocket,
            'shutdown_request',
            content
        );

        if (!restart) {
            await this.disconnect();
        }

        return reply.content;
    }
}
