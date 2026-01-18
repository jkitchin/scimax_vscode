/**
 * Tests for Zotero service - Better BibTeX API integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock http module
const mockRequest = vi.fn();
const mockRequestInstance = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn()
};

vi.mock('http', () => ({
    request: (...args: unknown[]) => {
        mockRequest(...args);
        return mockRequestInstance;
    }
}));

// Import after mocking
import {
    isZoteroRunning,
    openCitationPicker,
    exportBibTeX,
    searchZotero,
    getAttachments,
    type CAYWResult
} from '../zoteroService';

// Helper to create a mock response
function createMockResponse(statusCode: number, data: string) {
    const response = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
    response.statusCode = statusCode;
    response.resume = vi.fn();
    return response;
}

// Helper to simulate successful HTTP response
function simulateResponse(statusCode: number, data: string) {
    const response = createMockResponse(statusCode, data);

    // Get the callback from the last request call
    const callback = mockRequest.mock.calls[mockRequest.mock.calls.length - 1]?.[1];

    if (callback) {
        // Call the response callback
        callback(response);

        // Emit data and end events
        setImmediate(() => {
            response.emit('data', data);
            response.emit('end');
        });
    }

    return response;
}

// Helper to simulate error
function simulateError(error: Error) {
    const errorHandler = mockRequestInstance.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'error'
    )?.[1];

    if (errorHandler) {
        errorHandler(error);
    }
}

// Helper to simulate timeout
function simulateTimeout() {
    const timeoutHandler = mockRequestInstance.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'timeout'
    )?.[1];

    if (timeoutHandler) {
        timeoutHandler();
    }
}

describe('ZoteroService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mock implementations
        mockRequestInstance.on.mockImplementation(function(this: typeof mockRequestInstance) {
            return this;
        });
        mockRequestInstance.write.mockImplementation(function(this: typeof mockRequestInstance) {
            return this;
        });
        mockRequestInstance.end.mockImplementation(function(this: typeof mockRequestInstance) {
            return this;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('isZoteroRunning', () => {
        it('should return true when Zotero responds', async () => {
            const promise = isZoteroRunning();

            // Simulate successful response
            setImmediate(() => {
                simulateResponse(200, '{"result": true}');
            });

            const result = await promise;
            expect(result).toBe(true);
        });

        it('should return false on connection error', async () => {
            const promise = isZoteroRunning();

            setImmediate(() => {
                simulateError(new Error('ECONNREFUSED'));
            });

            const result = await promise;
            expect(result).toBe(false);
        });

        it('should return false on timeout', async () => {
            const promise = isZoteroRunning();

            setImmediate(() => {
                simulateTimeout();
            });

            const result = await promise;
            expect(result).toBe(false);
            expect(mockRequestInstance.destroy).toHaveBeenCalled();
        });

        it('should send correct JSON-RPC request', async () => {
            const promise = isZoteroRunning();

            setImmediate(() => {
                simulateResponse(200, '{}');
            });

            await promise;

            // Check request was made with correct options
            expect(mockRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    hostname: '127.0.0.1',
                    port: 23119,
                    path: '/better-bibtex/json-rpc',
                    method: 'POST',
                    timeout: 2000
                }),
                expect.any(Function)
            );

            // Check that api.ready method was sent
            expect(mockRequestInstance.write).toHaveBeenCalledWith(
                expect.stringContaining('"method":"api.ready"')
            );
        });
    });

    describe('openCitationPicker', () => {
        it('should parse single citation key', async () => {
            const promise = openCitationPicker();

            setImmediate(() => {
                simulateResponse(200, '[@smith2024]');
            });

            const result = await promise;
            expect(result).toEqual({
                keys: ['smith2024'],
                raw: '[@smith2024]'
            });
        });

        it('should parse multiple citation keys', async () => {
            const promise = openCitationPicker();

            setImmediate(() => {
                simulateResponse(200, '[@smith2024; @jones2023; @doe2022]');
            });

            const result = await promise;
            expect(result).toEqual({
                keys: ['smith2024', 'jones2023', 'doe2022'],
                raw: '[@smith2024; @jones2023; @doe2022]'
            });
        });

        it('should handle keys with special characters', async () => {
            const promise = openCitationPicker();

            setImmediate(() => {
                simulateResponse(200, '[@smith_jones:2024; @doe-2023]');
            });

            const result = await promise;
            expect(result).toEqual({
                keys: ['smith_jones:2024', 'doe-2023'],
                raw: '[@smith_jones:2024; @doe-2023]'
            });
        });

        it('should return null when user cancels (empty response)', async () => {
            const promise = openCitationPicker();

            setImmediate(() => {
                simulateResponse(200, '');
            });

            const result = await promise;
            expect(result).toBeNull();
        });

        it('should return null on non-200 status', async () => {
            const promise = openCitationPicker();

            setImmediate(() => {
                simulateResponse(404, 'Not found');
            });

            const result = await promise;
            expect(result).toBeNull();
        });

        it('should return null on error', async () => {
            const promise = openCitationPicker();

            setImmediate(() => {
                simulateError(new Error('Connection failed'));
            });

            const result = await promise;
            expect(result).toBeNull();
        });

        it('should return null on timeout', async () => {
            const promise = openCitationPicker();

            setImmediate(() => {
                simulateTimeout();
            });

            const result = await promise;
            expect(result).toBeNull();
        });

        it('should use correct CAYW URL with pandoc format', async () => {
            const promise = openCitationPicker();

            setImmediate(() => {
                simulateResponse(200, '[@test]');
            });

            await promise;

            expect(mockRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: '/better-bibtex/cayw?format=pandoc&brackets=1',
                    method: 'GET',
                    timeout: 300000 // 5 minutes
                }),
                expect.any(Function)
            );
        });

        it('should return null when response has no @ keys', async () => {
            const promise = openCitationPicker();

            setImmediate(() => {
                simulateResponse(200, 'no citations here');
            });

            const result = await promise;
            expect(result).toBeNull();
        });
    });

    describe('exportBibTeX', () => {
        const sampleBibTeX = `@article{smith2024machine,
  author = {Smith, John},
  title = {Machine Learning},
  year = {2024},
  journal = {Journal of AI}
}`;

        it('should export BibTeX for single key', async () => {
            const promise = exportBibTeX(['smith2024machine']);

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({
                    jsonrpc: '2.0',
                    result: sampleBibTeX,
                    id: 1
                }));
            });

            const result = await promise;
            expect(result).toBe(sampleBibTeX);
        });

        it('should export BibTeX for multiple keys', async () => {
            const multipleBibTeX = sampleBibTeX + '\n\n@book{jones2023,\n  author = {Jones},\n  title = {Book}\n}';
            const promise = exportBibTeX(['smith2024machine', 'jones2023']);

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({
                    jsonrpc: '2.0',
                    result: multipleBibTeX,
                    id: 1
                }));
            });

            const result = await promise;
            expect(result).toBe(multipleBibTeX);
        });

        it('should return null on JSON-RPC error', async () => {
            const promise = exportBibTeX(['nonexistent']);

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32600, message: 'Item not found' },
                    id: 1
                }));
            });

            const result = await promise;
            expect(result).toBeNull();
        });

        it('should return null on invalid JSON response', async () => {
            const promise = exportBibTeX(['test']);

            setImmediate(() => {
                simulateResponse(200, 'not valid json');
            });

            const result = await promise;
            expect(result).toBeNull();
        });

        it('should return null on HTTP error', async () => {
            const promise = exportBibTeX(['test']);

            setImmediate(() => {
                simulateResponse(500, 'Server error');
            });

            const result = await promise;
            expect(result).toBeNull();
        });

        it('should send correct JSON-RPC request with translator ID', async () => {
            const promise = exportBibTeX(['smith2024']);

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({ result: '' }));
            });

            await promise;

            // Check the write was called with correct payload
            const writeCall = mockRequestInstance.write.mock.calls[0]?.[0];
            expect(writeCall).toBeDefined();

            const payload = JSON.parse(writeCall);
            expect(payload.method).toBe('item.export');
            expect(payload.params[0]).toEqual(['smith2024']);
            expect(payload.params[1]).toBe('ca65189f-8815-4afe-8c8b-8c7c15f0edca');
        });
    });

    describe('searchZotero', () => {
        it('should return matching citation keys', async () => {
            const promise = searchZotero('machine learning');

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({
                    jsonrpc: '2.0',
                    result: [
                        { citekey: 'smith2024ml' },
                        { citekey: 'jones2023deep' }
                    ],
                    id: 1
                }));
            });

            const result = await promise;
            expect(result).toEqual(['smith2024ml', 'jones2023deep']);
        });

        it('should return empty array when no matches', async () => {
            const promise = searchZotero('nonexistent topic');

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({
                    jsonrpc: '2.0',
                    result: [],
                    id: 1
                }));
            });

            const result = await promise;
            expect(result).toEqual([]);
        });

        it('should filter out null/undefined citekeys', async () => {
            const promise = searchZotero('test');

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({
                    jsonrpc: '2.0',
                    result: [
                        { citekey: 'valid' },
                        { citekey: null },
                        { citekey: '' },
                        { citekey: 'also-valid' }
                    ],
                    id: 1
                }));
            });

            const result = await promise;
            expect(result).toEqual(['valid', 'also-valid']);
        });

        it('should return empty array on error', async () => {
            const promise = searchZotero('test');

            setImmediate(() => {
                simulateError(new Error('Connection failed'));
            });

            const result = await promise;
            expect(result).toEqual([]);
        });
    });

    describe('getAttachments', () => {
        it('should return attachment paths', async () => {
            const promise = getAttachments('smith2024');

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({
                    jsonrpc: '2.0',
                    result: [
                        { path: '/path/to/paper.pdf' },
                        { path: '/path/to/supplement.pdf' }
                    ],
                    id: 1
                }));
            });

            const result = await promise;
            expect(result).toEqual(['/path/to/paper.pdf', '/path/to/supplement.pdf']);
        });

        it('should return empty array when no attachments', async () => {
            const promise = getAttachments('no-attachments');

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({
                    jsonrpc: '2.0',
                    result: [],
                    id: 1
                }));
            });

            const result = await promise;
            expect(result).toEqual([]);
        });

        it('should filter out null/empty paths', async () => {
            const promise = getAttachments('test');

            setImmediate(() => {
                simulateResponse(200, JSON.stringify({
                    jsonrpc: '2.0',
                    result: [
                        { path: '/valid/path.pdf' },
                        { path: null },
                        { path: '' },
                        { path: '/another/valid.pdf' }
                    ],
                    id: 1
                }));
            });

            const result = await promise;
            expect(result).toEqual(['/valid/path.pdf', '/another/valid.pdf']);
        });

        it('should return empty array on error', async () => {
            const promise = getAttachments('test');

            setImmediate(() => {
                simulateError(new Error('Connection failed'));
            });

            const result = await promise;
            expect(result).toEqual([]);
        });
    });
});

describe('ZoteroService Edge Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRequestInstance.on.mockImplementation(function(this: typeof mockRequestInstance) {
            return this;
        });
        mockRequestInstance.write.mockImplementation(function(this: typeof mockRequestInstance) {
            return this;
        });
        mockRequestInstance.end.mockImplementation(function(this: typeof mockRequestInstance) {
            return this;
        });
    });

    it('should handle whitespace in CAYW response', async () => {
        const promise = openCitationPicker();

        setImmediate(() => {
            simulateResponse(200, '  [@smith2024]  \n');
        });

        const result = await promise;
        expect(result?.keys).toEqual(['smith2024']);
    });

    it('should handle chunked response data', async () => {
        const promise = openCitationPicker();

        const response = createMockResponse(200, '');
        const callback = mockRequest.mock.calls[mockRequest.mock.calls.length - 1]?.[1];

        if (callback) {
            callback(response);

            // Simulate chunked data
            setImmediate(() => {
                response.emit('data', '[@smith');
                response.emit('data', '2024; @jones');
                response.emit('data', '2023]');
                response.emit('end');
            });
        }

        const result = await promise;
        expect(result?.keys).toEqual(['smith2024', 'jones2023']);
    });

    it('should handle very long citation keys', async () => {
        const longKey = 'a'.repeat(100) + '2024';
        const promise = openCitationPicker();

        setImmediate(() => {
            simulateResponse(200, `[@${longKey}]`);
        });

        const result = await promise;
        expect(result?.keys).toEqual([longKey]);
    });
});

describe('Cancellation Support', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRequestInstance.on.mockImplementation(function(this: typeof mockRequestInstance) {
            return this;
        });
        mockRequestInstance.write.mockImplementation(function(this: typeof mockRequestInstance) {
            return this;
        });
        mockRequestInstance.end.mockImplementation(function(this: typeof mockRequestInstance) {
            return this;
        });
    });

    it('should return null when cancellation is already requested', async () => {
        const cancellationToken = {
            isCancellationRequested: true,
            onCancellationRequested: vi.fn()
        };

        const result = await openCitationPicker(cancellationToken);

        expect(result).toBeNull();
        expect(mockRequestInstance.destroy).toHaveBeenCalled();
    });

    it('should register cancellation handler', async () => {
        let capturedCallback: (() => void) | null = null;
        const cancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: vi.fn().mockImplementation((callback: () => void) => {
                capturedCallback = callback;
            })
        };

        const promise = openCitationPicker(cancellationToken);

        // Verify callback was registered
        expect(cancellationToken.onCancellationRequested).toHaveBeenCalled();

        // Simulate successful response
        setImmediate(() => {
            simulateResponse(200, '[@smith2024]');
        });

        const result = await promise;
        expect(result?.keys).toEqual(['smith2024']);
    });

    it('should cancel request when cancellation is triggered', async () => {
        let capturedCallback: (() => void) | null = null;
        const cancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: vi.fn().mockImplementation((callback: () => void) => {
                capturedCallback = callback;
            })
        };

        const promise = openCitationPicker(cancellationToken);

        // Trigger cancellation before response
        setImmediate(() => {
            if (capturedCallback) {
                capturedCallback();
            }
        });

        const result = await promise;
        expect(result).toBeNull();
        expect(mockRequestInstance.destroy).toHaveBeenCalled();
    });

    it('should work without cancellation token', async () => {
        const promise = openCitationPicker();

        setImmediate(() => {
            simulateResponse(200, '[@smith2024]');
        });

        const result = await promise;
        expect(result?.keys).toEqual(['smith2024']);
    });
});
