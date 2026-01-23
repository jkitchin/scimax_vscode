/**
 * Jupyter Protocol Types
 * Based on Jupyter Messaging Protocol v5.3
 * https://jupyter-client.readthedocs.io/en/stable/messaging.html
 */

// =============================================================================
// Kernel Spec Types
// =============================================================================

/**
 * Kernel specification from kernelspec
 */
export interface KernelSpec {
    /** Kernel name (directory name) */
    name: string;
    /** Display name for UI */
    displayName: string;
    /** Language name */
    language: string;
    /** Path to kernel.json */
    resourceDir: string;
    /** Argv to launch kernel */
    argv: string[];
    /** Environment variables */
    env?: Record<string, string>;
    /** Interrupt mode: signal or message */
    interruptMode?: 'signal' | 'message';
    /** Metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Connection info from connection file
 */
export interface ConnectionInfo {
    /** IP address for ZMQ */
    ip: string;
    /** Transport protocol */
    transport: 'tcp' | 'ipc';
    /** Shell port */
    shell_port: number;
    /** IOPub port */
    iopub_port: number;
    /** Stdin port */
    stdin_port: number;
    /** Control port */
    control_port: number;
    /** Heartbeat port */
    hb_port: number;
    /** HMAC key for message signing */
    key: string;
    /** Signature scheme */
    signature_scheme: 'hmac-sha256';
    /** Kernel name */
    kernel_name?: string;
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * Jupyter message header
 */
export interface MessageHeader {
    /** Unique message ID */
    msg_id: string;
    /** Session ID */
    session: string;
    /** Username */
    username: string;
    /** Timestamp (ISO 8601) */
    date: string;
    /** Message type */
    msg_type: string;
    /** Protocol version */
    version: string;
}

/**
 * Base Jupyter message structure
 */
export interface JupyterMessage<T = unknown> {
    /** Message header */
    header: MessageHeader;
    /** Parent message header (for replies) */
    parent_header: MessageHeader | Record<string, never>;
    /** Message metadata */
    metadata: Record<string, unknown>;
    /** Message content */
    content: T;
    /** Extra binary buffers */
    buffers?: Buffer[];
}

// =============================================================================
// Request Content Types
// =============================================================================

/**
 * Execute request content
 */
export interface ExecuteRequestContent {
    /** Code to execute */
    code: string;
    /** Silent execution (no output) */
    silent: boolean;
    /** Store result in history */
    store_history: boolean;
    /** User expressions to evaluate */
    user_expressions: Record<string, string>;
    /** Allow stdin requests */
    allow_stdin: boolean;
    /** Stop on error */
    stop_on_error: boolean;
}

/**
 * Inspect request content (introspection)
 */
export interface InspectRequestContent {
    /** Code context */
    code: string;
    /** Cursor position */
    cursor_pos: number;
    /** Detail level (0 or 1) */
    detail_level: 0 | 1;
}

/**
 * Complete request content (code completion)
 */
export interface CompleteRequestContent {
    /** Code context */
    code: string;
    /** Cursor position */
    cursor_pos: number;
}

/**
 * Kernel info request (empty content)
 */
export type KernelInfoRequestContent = Record<string, never>;

/**
 * Interrupt request (empty content)
 */
export type InterruptRequestContent = Record<string, never>;

/**
 * Shutdown request content
 */
export interface ShutdownRequestContent {
    /** Restart after shutdown */
    restart: boolean;
}

/**
 * Is complete request content
 */
export interface IsCompleteRequestContent {
    /** Code to check */
    code: string;
}

// =============================================================================
// Reply Content Types
// =============================================================================

/**
 * Execute reply content
 */
export interface ExecuteReplyContent {
    /** Status: ok, error, or aborted */
    status: 'ok' | 'error' | 'aborted';
    /** Execution count */
    execution_count: number;
    /** User expression results (if ok) */
    user_expressions?: Record<string, unknown>;
    /** Error name (if error) */
    ename?: string;
    /** Error value (if error) */
    evalue?: string;
    /** Traceback (if error) */
    traceback?: string[];
}

/**
 * Inspect reply content
 */
export interface InspectReplyContent {
    /** Status */
    status: 'ok' | 'error';
    /** Found documentation */
    found: boolean;
    /** Documentation data (MIME bundle) */
    data: Record<string, string>;
    /** Metadata */
    metadata: Record<string, unknown>;
}

/**
 * Complete reply content
 */
export interface CompleteReplyContent {
    /** Status */
    status: 'ok' | 'error';
    /** Completion matches */
    matches: string[];
    /** Start of completion range */
    cursor_start: number;
    /** End of completion range */
    cursor_end: number;
    /** Metadata per match */
    metadata: Record<string, unknown>;
}

/**
 * Kernel info reply content
 */
export interface KernelInfoReplyContent {
    /** Status */
    status: 'ok';
    /** Protocol version */
    protocol_version: string;
    /** Implementation name */
    implementation: string;
    /** Implementation version */
    implementation_version: string;
    /** Language info */
    language_info: {
        name: string;
        version: string;
        mimetype: string;
        file_extension: string;
        pygments_lexer?: string;
        codemirror_mode?: string | Record<string, unknown>;
        nbconvert_exporter?: string;
    };
    /** Banner text */
    banner: string;
    /** Help links */
    help_links?: Array<{ text: string; url: string }>;
}

/**
 * Shutdown reply content
 */
export interface ShutdownReplyContent {
    /** Status */
    status: 'ok';
    /** Restart flag echoed back */
    restart: boolean;
}

/**
 * Is complete reply content
 */
export interface IsCompleteReplyContent {
    /** Completeness status */
    status: 'complete' | 'incomplete' | 'invalid' | 'unknown';
    /** Indent hint (if incomplete) */
    indent?: string;
}

// =============================================================================
// IOPub Content Types
// =============================================================================

/**
 * Stream output content
 */
export interface StreamContent {
    /** Stream name: stdout or stderr */
    name: 'stdout' | 'stderr';
    /** Output text */
    text: string;
}

/**
 * Display data content
 */
export interface DisplayDataContent {
    /** MIME bundle */
    data: Record<string, string>;
    /** Metadata */
    metadata: Record<string, unknown>;
    /** Transient info */
    transient?: {
        display_id?: string;
    };
}

/**
 * Execute input content (re-broadcast of input)
 */
export interface ExecuteInputContent {
    /** Code being executed */
    code: string;
    /** Execution count */
    execution_count: number;
}

/**
 * Execute result content
 */
export interface ExecuteResultContent {
    /** Execution count */
    execution_count: number;
    /** Result data (MIME bundle) */
    data: Record<string, string>;
    /** Metadata */
    metadata: Record<string, unknown>;
}

/**
 * Error content
 */
export interface ErrorContent {
    /** Error name */
    ename: string;
    /** Error value */
    evalue: string;
    /** Traceback */
    traceback: string[];
}

/**
 * Kernel status content
 */
export interface StatusContent {
    /** Execution state */
    execution_state: 'busy' | 'idle' | 'starting';
}

/**
 * Clear output content
 */
export interface ClearOutputContent {
    /** Wait before clearing */
    wait: boolean;
}

// =============================================================================
// Stdin Content Types
// =============================================================================

/**
 * Input request content
 */
export interface InputRequestContent {
    /** Prompt text */
    prompt: string;
    /** Password mode */
    password: boolean;
}

/**
 * Input reply content
 */
export interface InputReplyContent {
    /** User input */
    value: string;
}

// =============================================================================
// Kernel State
// =============================================================================

/**
 * Kernel execution state
 */
export type KernelState = 'starting' | 'idle' | 'busy' | 'dead' | 'unknown';

/**
 * Kernel info for UI
 */
export interface KernelInfo {
    /** Kernel spec */
    spec: KernelSpec;
    /** Connection info */
    connection: ConnectionInfo;
    /** Current state */
    state: KernelState;
    /** Process ID */
    pid?: number;
    /** Session ID */
    sessionId: string;
}

// =============================================================================
// Execution Result
// =============================================================================

/**
 * Collected execution output
 */
export interface ExecutionOutput {
    /** All stdout text */
    stdout: string;
    /** All stderr text */
    stderr: string;
    /** Rich output data (MIME bundles) */
    displayData: DisplayDataContent[];
    /** Execute result */
    result?: ExecuteResultContent;
    /** Error if any */
    error?: ErrorContent;
    /** Execution count */
    executionCount?: number;
}
