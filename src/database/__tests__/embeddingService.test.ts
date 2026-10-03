/**
 * Error reporting of the Ollama embedding client.
 */

import { describe, it, expect, vi } from 'vitest';
import * as net from 'net';
import { OllamaEmbeddingService } from '../embeddingService';

vi.mock('vscode', () => ({}));

/** A localhost port with nothing listening on it. */
async function closedPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>(resolve => server.close(() => resolve()));
    return port;
}

describe('OllamaEmbeddingService errors', () => {
    it('says Ollama is unreachable instead of "AggregateError"', async () => {
        const url = `http://localhost:${await closedPort()}`;
        const service = new OllamaEmbeddingService(url, 'nomic-embed-text');
        await expect(service.embed('hello')).rejects.toThrow(
            `Cannot connect to Ollama at ${url} (connection refused). Is Ollama running?`
        );
    });
});
